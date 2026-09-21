import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueJob } from "@/lib/queue/queues";
import { usesDatabaseJobRunner } from "@/lib/env";
import { logError } from "@/lib/logger";
import type { JobType } from "@/types/domain";

export async function createBackgroundJob(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    jobType: JobType;
    entityType?: string;
    entityId?: string;
    userId?: string;
    progress?: Record<string, unknown>;
  }
) {
  const { data, error } = await supabase
    .from("background_jobs")
    .insert({
      organization_id: input.organizationId,
      job_type: input.jobType,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      status: "QUEUED",
      created_by: input.userId ?? null,
      progress: input.progress ?? {},
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Could not create background job.");
  }

  // The database runner claims this row from /api/cron/jobs, so Redis is not involved.
  // Enqueueing to BullMQ as well would let both runners execute the same job.
  if (usesDatabaseJobRunner()) {
    return data;
  }

  try {
    await enqueueJob(input.jobType, {
      organizationId: input.organizationId,
      jobId: data.id,
      entityType: input.entityType,
      entityId: input.entityId,
      userId: input.userId,
    });
  } catch (queueError) {
    logError("queue.enqueue_failed", {
      jobId: data.id,
      message: queueError instanceof Error ? queueError.message : "redis unavailable",
    });
    await supabase
      .from("background_jobs")
      .update({
        last_error: "Redis is unreachable. Set JOB_RUNNER=database or start the BullMQ workers.",
        last_error_code: "QUEUE_UNAVAILABLE",
      })
      .eq("id", data.id);
  }

  return data;
}
