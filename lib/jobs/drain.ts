import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { usesDatabaseJobRunner } from "@/lib/env";
import { runPool } from "@/lib/async/pool";
import { indiaPostBookingConcurrency } from "@/modules/india-post/booking-batch";
import { logError, logInfo } from "@/lib/logger";
import type { JobPayload } from "@/lib/queue/queues";
import { processJob } from "@/workers/processor";

export const DEFAULT_DRAIN_LIMIT = 5;

export type ClaimedJob = {
  id: string;
  organization_id: string;
  job_type: string;
  entity_type: string | null;
  entity_id: string | null;
  created_by: string | null;
  attempt_count: number;
  progress?: { shipmentIds?: string[] } | null;
};

export function claimedJobFromRow(row: {
  id: string;
  organization_id: string;
  job_type: string;
  entity_type?: string | null;
  entity_id?: string | null;
  created_by?: string | null;
  attempt_count?: number | null;
  progress?: { shipmentIds?: string[] } | null;
}): ClaimedJob {
  return {
    id: row.id,
    organization_id: row.organization_id,
    job_type: row.job_type,
    entity_type: row.entity_type ?? null,
    entity_id: row.entity_id ?? null,
    created_by: row.created_by ?? null,
    attempt_count: row.attempt_count ?? 0,
    progress: row.progress ?? null,
  };
}

export function jobPayloadFromClaimed(job: ClaimedJob): JobPayload {
  return {
    organizationId: job.organization_id,
    jobId: job.id,
    entityType: job.entity_type ?? undefined,
    entityId: job.entity_id ?? undefined,
    shipmentIds: job.progress?.shipmentIds,
    userId: job.created_by ?? undefined,
  };
}

export type DrainResult = {
  claimed: number;
  succeeded: number;
  failed: number;
};

export async function runClaimedJobs(
  jobs: ClaimedJob[],
  process: (job: ClaimedJob) => Promise<void>
): Promise<{ succeeded: number; failed: number }> {
  const result = { succeeded: 0, failed: 0 };
  const bookings = jobs.filter((job) => job.job_type === "shipment-booking");
  const rest = jobs.filter((job) => job.job_type !== "shipment-booking");
  const run = async (batch: ClaimedJob[], concurrency: number) => {
    await runPool(batch, concurrency, async (job) => {
      logInfo("jobs.drain_start", {
        jobId: job.id,
        jobType: job.job_type,
        organizationId: job.organization_id,
        attempt: job.attempt_count + 1,
      });
      try {
        await process(job);
        result.succeeded += 1;
      } catch (jobError) {
        result.failed += 1;
        logError("jobs.drain_failed", {
          jobId: job.id,
          jobType: job.job_type,
          organizationId: job.organization_id,
          message: jobError instanceof Error ? jobError.message : "job failed",
        });
      }
    });
  };
  await run(bookings, indiaPostBookingConcurrency());
  await run(rest, 2);
  return result;
}

export async function drainDueJobs(limit = DEFAULT_DRAIN_LIMIT): Promise<DrainResult> {
  if (!hasAdminClient()) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set, so background jobs cannot run. Jobs bypass RLS and need the service role."
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("claim_background_jobs", { p_limit: limit });

  if (error) {
    throw new Error(error.message || "Could not claim background jobs.");
  }

  const jobs = (data ?? []) as ClaimedJob[];
  const processed = await runClaimedJobs(jobs, async (job) => {
    await processJob(job.job_type, jobPayloadFromClaimed(job));
  });

  return { claimed: jobs.length, ...processed };
}

async function claimQueuedJob(job: ClaimedJob): Promise<ClaimedJob | null> {
  if (!hasAdminClient()) return null;
  const supabase = createAdminClient();
  const lockedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("background_jobs")
    .update({
      status: "RUNNING",
      locked_at: lockedAt,
      started_at: lockedAt,
    })
    .eq("id", job.id)
    .in("status", ["PENDING", "QUEUED"])
    .select("id, organization_id, job_type, entity_type, entity_id, created_by, attempt_count, progress")
    .maybeSingle();
  if (error || !data) return null;
  return claimedJobFromRow(data);
}

/** Run just-queued jobs in this request so booking/labels do not wait for the minute cron. */
export async function runQueuedJobsNow(jobs: ClaimedJob[]): Promise<DrainResult> {
  const unique = [...new Map(jobs.map((job) => [job.id, job])).values()];
  if (!unique.length || !usesDatabaseJobRunner() || !hasAdminClient()) {
    return { claimed: 0, succeeded: 0, failed: 0 };
  }
  const claimed: ClaimedJob[] = [];
  for (const job of unique) {
    const row = await claimQueuedJob(job);
    if (row) claimed.push(row);
  }
  const processed = await runClaimedJobs(claimed, async (job) => {
    await processJob(job.job_type, jobPayloadFromClaimed(job));
  });
  return { claimed: claimed.length, ...processed };
}
