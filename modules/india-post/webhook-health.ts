import { PRODUCTION_APP_ORIGIN } from "@/lib/auth/urls";
import type { createAdminClient } from "@/lib/supabase/admin";
import { isIndiaPostWebhookQuarantined } from "@/modules/india-post/webhook-allowlist";
import { indiaPostWebhookUrls } from "@/modules/india-post/webhook-urls";

export const INDIA_POST_WEBHOOK_HEALTH_CUSTOMER = "1788590988";

export type IndiaPostWebhookHealth = {
  ingestQuarantined: boolean;
  senderAuthentication: "none-verified";
  productionCallbacks: {
    customerId: string;
    eventsWebhookUrl: string;
    bookingWebhookUrl: string;
  };
  inbox: {
    pending: number;
    processed: number;
    failed: number;
    lastReceivedAt: string | null;
    lastProcessedAt: string | null;
    lastFailedAt: string | null;
  };
  jobs: {
    failedLast24h: number;
    lastFailureAt: string | null;
    lastFailureCode: string | null;
  };
};

async function countInbox(
  supabase: ReturnType<typeof createAdminClient>,
  status?: "PENDING" | "PROCESSED" | "FAILED"
) {
  let query = supabase.from("provider_webhook_inbox").select("id", { count: "exact", head: true });
  if (status) query = query.eq("process_status", status);
  const { count } = await query;
  return count ?? 0;
}

export async function loadIndiaPostWebhookHealth(
  supabase: ReturnType<typeof createAdminClient>
): Promise<IndiaPostWebhookHealth> {
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const [
    pending,
    processed,
    failed,
    latestReceived,
    latestProcessed,
    latestFailed,
    failedJobCount,
    latestFailedJob,
  ] = await Promise.all([
    countInbox(supabase, "PENDING"),
    countInbox(supabase, "PROCESSED"),
    countInbox(supabase, "FAILED"),
    supabase
      .from("provider_webhook_inbox")
      .select("received_at")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("provider_webhook_inbox")
      .select("processed_at")
      .eq("process_status", "PROCESSED")
      .order("processed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("provider_webhook_inbox")
      .select("processed_at")
      .eq("process_status", "FAILED")
      .order("processed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("background_jobs")
      .select("id", { count: "exact", head: true })
      .eq("job_type", "india-post-events")
      .eq("status", "FAILED")
      .gte("created_at", since),
    supabase
      .from("background_jobs")
      .select("created_at, last_error_code")
      .eq("job_type", "india-post-events")
      .eq("status", "FAILED")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const jobRows = latestFailedJob.data ? [latestFailedJob.data] : [];
  const callbacks = indiaPostWebhookUrls(
    "00000000-0000-4000-8000-000000000000",
    PRODUCTION_APP_ORIGIN,
    INDIA_POST_WEBHOOK_HEALTH_CUSTOMER
  );

  return {
    ingestQuarantined: isIndiaPostWebhookQuarantined(),
    senderAuthentication: "none-verified",
    productionCallbacks: {
      customerId: INDIA_POST_WEBHOOK_HEALTH_CUSTOMER,
      eventsWebhookUrl: callbacks.eventsWebhookUrl,
      bookingWebhookUrl: callbacks.bookingWebhookUrl,
    },
    inbox: {
      pending,
      processed,
      failed,
      lastReceivedAt: latestReceived.data?.received_at ?? null,
      lastProcessedAt: latestProcessed.data?.processed_at ?? null,
      lastFailedAt: latestFailed.data?.processed_at ?? null,
    },
    jobs: {
      failedLast24h: failedJobCount.count ?? 0,
      lastFailureAt: jobRows[0]?.created_at ?? null,
      lastFailureCode: jobRows[0]?.last_error_code ?? null,
    },
  };
}
