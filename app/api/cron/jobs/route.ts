import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { authorizeCron } from "@/lib/jobs/cron-auth";
import { DEFAULT_DRAIN_LIMIT, drainDueJobs, runQueuedJobsNow } from "@/lib/jobs/drain";
import { parseJobTypes, wooCommerceDrainPlan } from "@/lib/jobs/job-lanes";
import { logError } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { enqueueDueTrackingSyncJobs } from "@/modules/india-post/tracking-sync";
import { enqueueSameBarcodeRecovery, releaseParkedBookingShipments, runBookingAutoRecovery } from "@/modules/india-post/booking-recovery";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = authorizeCron(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ success: false, message: auth.reason }, { status: 401 });
  }

  if (env.jobRunner !== "database") {
    return NextResponse.json(
      {
        success: false,
        message: "JOB_RUNNER is set to redis, so BullMQ workers own the queue.",
      },
      { status: 409 }
    );
  }

  const requested = Number(request.nextUrl.searchParams.get("limit"));
  const limit =
    Number.isFinite(requested) && requested > 0 ? Math.min(Math.trunc(requested), 25) : DEFAULT_DRAIN_LIMIT;

  let jobTypes: ReturnType<typeof parseJobTypes>;
  try {
    jobTypes = parseJobTypes(request.nextUrl.searchParams.get("types"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown job type.";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }

  try {
    const shouldEnqueueTracking = !jobTypes || jobTypes.includes("tracking-sync");
    if (shouldEnqueueTracking && hasAdminClient()) {
      await enqueueDueTrackingSyncJobs(createAdminClient());
    }
    const wooPlan = wooCommerceDrainPlan(jobTypes);
    if (hasAdminClient() && (!jobTypes || wooPlan.woo)) {
      // Polling fallback so WooCommerce orders still import when webhooks are missing or dropped.
      // The other lane (tracking / Shopify) triggers this even when JOB_TYPES omits woocommerce-sync.
      try {
        const { enqueueDueWooCommerceSyncJobs } = await import("@/modules/woocommerce/sync-job");
        await enqueueDueWooCommerceSyncJobs(createAdminClient());
      } catch (pollError) {
        logError("woocommerce.poll_failed", {
          message: pollError instanceof Error ? pollError.message : "WooCommerce poll failed.",
        });
      }
    }
    if (hasAdminClient()) {
      const { sweepAbandonedSignups } = await import("@/modules/vachat/abandoned-signup");
      await sweepAbandonedSignups(createAdminClient());
    }
    if (hasAdminClient() && (!jobTypes || jobTypes.includes("accounting-rebuild"))) {
      const { enqueueDueLedgerSyncJobs } = await import("@/modules/ai-accountant/ledger/schedule");
      await enqueueDueLedgerSyncJobs(createAdminClient());
    }
    if (hasAdminClient() && (!jobTypes || jobTypes.includes("booking-queue-dispatch"))) {
      // Automatic Bulk Booking: due workspaces get a dispatch job, drained below or next tick.
      try {
        const { enqueueDueBookingQueueDispatches } = await import("@/modules/booking-queue/scheduler");
        await enqueueDueBookingQueueDispatches(createAdminClient());
      } catch (scanError) {
        logError("booking_queue.scan_failed", {
          message: scanError instanceof Error ? scanError.message : "Bulk Booking scan failed.",
        });
      }
    }
    let recovery: { enabled: boolean; recovered: number; skipped: number } | { error: string } = {
      enabled: false,
      recovered: 0,
      skipped: 0,
    };
    if ((!jobTypes || jobTypes.includes("shipment-booking")) && hasAdminClient()) {
      try {
        const admin = createAdminClient();
        recovery = await runBookingAutoRecovery(admin);
        await releaseParkedBookingShipments(admin).catch((parkError) => {
          logError("booking.parked_release_failed", {
            message: parkError instanceof Error ? parkError.message : "parked release failed",
          });
        });
        await enqueueSameBarcodeRecovery(admin).catch((enqueueError) => {
          logError("booking.same_barcode_requeue_failed", {
            message: enqueueError instanceof Error ? enqueueError.message : "enqueue failed",
          });
        });
      } catch (recoveryError) {
        const message = recoveryError instanceof Error ? recoveryError.message : "Booking recovery failed.";
        logError("booking.recovery_failed", { message });
        recovery = { error: message };
      }
    }
    const drained = wooPlan.skipPrimary
      ? { claimed: 0, succeeded: 0, failed: 0 }
      : await drainDueJobs(limit, wooPlan.primary);
    if (hasAdminClient() && wooPlan.woo) {
      try {
        const { listWooCommerceJobsToDrain } = await import("@/modules/woocommerce/sync-job");
        const wooJobs = await listWooCommerceJobsToDrain(createAdminClient());
        const woo = await runQueuedJobsNow(wooJobs);
        drained.claimed += woo.claimed;
        drained.succeeded += woo.succeeded;
        drained.failed += woo.failed;
      } catch (wooError) {
        logError("woocommerce.drain_failed", {
          message: wooError instanceof Error ? wooError.message : "WooCommerce drain failed.",
        });
      }
    }
    let sheetsCrm: { processed: number; skipped?: boolean; failed?: number } = { processed: 0, skipped: true };
    if (hasAdminClient()) {
      try {
        const { drainSheetsCrmOutbox } = await import("@/modules/sheets-crm/deliver");
        sheetsCrm = await drainSheetsCrmOutbox(createAdminClient());
      } catch (sheetsError) {
        logError("sheets_crm.drain_failed", {
          message: sheetsError instanceof Error ? sheetsError.message : "Google Sheets CRM drain failed.",
        });
      }
    }
    return NextResponse.json({ success: true, data: { ...drained, recovery, sheetsCrm } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not drain background jobs.";
    logError("jobs.drain_error", { message });
    // The endpoint is gated by CRON_SECRET, so the operator running it gets the reason.
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
