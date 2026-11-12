import { NextResponse, type NextRequest } from "next/server";
import { authorizeCron } from "@/lib/jobs/cron-auth";
import { logError, logInfo } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { runBillingSweep } from "@/modules/billing/cron";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const started = Date.now();
  const auth = authorizeCron(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ success: false, message: auth.reason }, { status: 401 });
  }
  if (!hasAdminClient()) {
    return NextResponse.json({ success: false, message: "Service role is not configured." }, { status: 503 });
  }
  try {
    const result = await runBillingSweep(createAdminClient());
    const { runAddonBillingSweep } = await import("@/modules/addons/cron");
    const addons = await runAddonBillingSweep(createAdminClient());
    // Recover captured payments whose browser verify and webhook both failed.
    // Read-only against Razorpay; activation goes through the same fulfillment RPC.
    let reconciliation: Record<string, unknown> | null = null;
    try {
      const { isBillingConfiguredAsync } = await import("@/modules/razorpay/config");
      if (await isBillingConfiguredAsync()) {
        const { reconcilePendingSubscriptionPayments } = await import("@/modules/billing/reconcile");
        reconciliation = await reconcilePendingSubscriptionPayments(createAdminClient());
      }
    } catch (reconcileError) {
      logError("billing.reconcile_http_failed", {
        message: reconcileError instanceof Error ? reconcileError.message : "unknown",
      });
    }
    try {
      const { sweepSheetsCrmAbandonment } = await import("@/modules/sheets-crm/abandonment-sweep");
      await sweepSheetsCrmAbandonment(createAdminClient());
    } catch (sheetsError) {
      logError("sheets_crm.abandon_sweep_failed", {
        message: sheetsError instanceof Error ? sheetsError.message : "abandonment sweep failed",
      });
    }
    logInfo("billing.cron_http_ok", {
      durationMs: Date.now() - started,
      expired: result.expired,
      skipped: result.skipped,
      failures: result.failures,
      addonsExpired: addons.expired,
    });
    return NextResponse.json({
      success: true,
      data: {
        expired: result.expired,
        skipped: result.skipped,
        failures: result.failures,
        eligible: result.eligible,
        expiringNotices: result.expiringNotices,
        reconciled: result.reconciled,
        durationMs: result.durationMs,
        status: result.status,
        addons,
        reconciliation,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Billing sweep failed.";
    logError("billing.cron_failed", { message, durationMs: Date.now() - started });
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
