import type { SupabaseClient } from "@supabase/supabase-js";
import { createBackgroundJob } from "@/modules/jobs/service";
import { loadShopifyConnection, shopifyReadyToSync } from "@/modules/shopify/orders";

const ACTIVE_SYNC_STATUSES = ["QUEUED", "RUNNING", "RETRYING"];

export type EnqueueShopifySyncInput = {
  organizationId: string;
  userId?: string;
  force?: boolean;
  pageInfo?: string | null;
  imported?: number;
  updated?: number;
  skipped?: number;
};

export async function enqueueShopifyOrderSync(
  supabase: SupabaseClient,
  input: EnqueueShopifySyncInput
) {
  const connection = await loadShopifyConnection(supabase, input.organizationId);
  if (!shopifyReadyToSync(connection) && connection?.status !== "CONNECTED") {
    return { queued: false as const, connected: false as const, jobId: null, duplicate: false };
  }

  if (!input.pageInfo) {
    const { data: existing } = await supabase
      .from("background_jobs")
      .select("id, status")
      .eq("organization_id", input.organizationId)
      .eq("job_type", "shopify-sync")
      .in("status", ACTIVE_SYNC_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      return {
        queued: true as const,
        connected: true as const,
        jobId: existing.id as string,
        duplicate: true,
        status: existing.status as string,
      };
    }
  }

  const job = await createBackgroundJob(supabase, {
    organizationId: input.organizationId,
    jobType: "shopify-sync",
    entityType: "shopify_connection",
    userId: input.userId,
    progress: {
      force: Boolean(input.force),
      pageInfo: input.pageInfo ?? null,
      imported: input.imported ?? 0,
      updated: input.updated ?? 0,
      skipped: input.skipped ?? 0,
    },
  });

  return {
    queued: true as const,
    connected: true as const,
    jobId: job.id as string,
    duplicate: false,
    status: job.status as string,
  };
}

export async function latestShopifySyncJob(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("background_jobs")
    .select("id, status, last_error, created_at, completed_at, progress")
    .eq("organization_id", organizationId)
    .eq("job_type", "shopify-sync")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}
