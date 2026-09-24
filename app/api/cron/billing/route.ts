import { NextResponse, type NextRequest } from "next/server";
import { authorizeCron } from "@/lib/jobs/cron-auth";
import { logError } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { runBillingSweep } from "@/modules/billing/cron";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = authorizeCron(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ success: false, message: auth.reason }, { status: 401 });
  }
  if (!hasAdminClient()) {
    return NextResponse.json({ success: false, message: "Service role is not configured." }, { status: 503 });
  }
  try {
    const result = await runBillingSweep(createAdminClient());
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Billing sweep failed.";
    logError("billing.cron_failed", { message });
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
