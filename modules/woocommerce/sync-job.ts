import type { SupabaseClient } from "@supabase/supabase-js";
import { createBackgroundJob } from "@/modules/jobs/service";
import { credentialsFromConnection, loadWooConnection } from "@/modules/woocommerce/connect";

const ACTIVE = ["QUEUED", "RUNNING", "RETRYING"];

export async function enqueueWooCommerceSync(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    userId?: string;
    force?: boolean;
    page?: number;
    imported?: number;
    updated?: number;
    skipped?: number;
  }
) {
  const connection = await loadWooConnection(supabase, input.organizationId);
  if (!connection || connection.status !== "CONNECTED" || !credentialsFromConnection(connection)) {
    return { queued: false as const, connected: false as const, jobId: null, duplicate: false };
  }
  if (!input.page) {
    const { data: existing } = await supabase
      .from("background_jobs")
      .select("id, status")
      .eq("organization_id", input.organizationId)
      .eq("job_type", "woocommerce-sync")
      .in("status", ACTIVE)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      return { queued: true as const, connected: true as const, jobId: existing.id as string, duplicate: true };
    }
  }
  const job = await createBackgroundJob(supabase, {
    organizationId: input.organizationId,
    jobType: "woocommerce-sync",
    entityType: "woocommerce_connection",
    entityId: connection.id,
    userId: input.userId,
    progress: {
      mode: "import",
      force: Boolean(input.force),
      page: input.page ?? 1,
      imported: input.imported ?? 0,
      updated: input.updated ?? 0,
      skipped: input.skipped ?? 0,
    },
  });
  return { queued: true as const, connected: true as const, jobId: job.id as string, duplicate: false };
}

export async function enqueueWooWebhookJob(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    connectionId: string;
    deliveryId: string;
    topic: string;
    orderId: string;
  }
) {
  const job = await createBackgroundJob(supabase, {
    organizationId: input.organizationId,
    jobType: "woocommerce-sync",
    entityType: "woocommerce_connection",
    entityId: input.connectionId,
    progress: {
      mode: "webhook",
      force: true,
      deliveryId: input.deliveryId,
      topic: input.topic,
      orderId: input.orderId,
    },
  });
  return job.id as string;
}
