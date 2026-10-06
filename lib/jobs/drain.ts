import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { usesDatabaseJobRunner } from "@/lib/env";
import { runPool } from "@/lib/async/pool";
import { indiaPostBookingConcurrency } from "@/modules/india-post/booking-batch";
import { shouldWaitForQueuedBookings } from "@/modules/india-post/http";
import { drainLaneName, restDrainConcurrency } from "@/lib/jobs/job-lanes";
import { queueWaitMs } from "@/lib/jobs/timing";
import { logError, logInfo } from "@/lib/logger";
import type { JobPayload } from "@/lib/queue/queues";
import { processJob } from "@/workers/processor";

export const DEFAULT_DRAIN_LIMIT = 20;

export type ClaimedJob = {
  id: string;
  organization_id: string;
  job_type: string;
  entity_type: string | null;
  entity_id: string | null;
  created_by: string | null;
  attempt_count: number;
  created_at?: string | null;
  locked_at?: string | null;
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
  created_at?: string | null;
  locked_at?: string | null;
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
    created_at: row.created_at ?? null,
    locked_at: row.locked_at ?? null,
    progress: row.progress ?? null,
  };
}

export function jobPayloadFromClaimed(job: ClaimedJob): JobPayload {
  const wait = queueWaitMs(job.created_at);
  return {
    organizationId: job.organization_id,
    jobId: job.id,
    entityType: job.entity_type ?? undefined,
    entityId: job.entity_id ?? undefined,
    shipmentIds: job.progress?.shipmentIds,
    userId: job.created_by ?? undefined,
    attempt: job.attempt_count,
    ...(wait !== undefined ? { queueWaitMs: wait } : {}),
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
        queueWaitMs: queueWaitMs(job.created_at),
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
  await run(rest, restDrainConcurrency(bookings.length));
  return result;
}

export async function drainDueJobs(limit = DEFAULT_DRAIN_LIMIT, jobTypes?: string[]): Promise<DrainResult> {
  if (!hasAdminClient()) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set, so background jobs cannot run. Jobs bypass RLS and need the service role."
    );
  }

  const supabase = createAdminClient();
  const lane = drainLaneName(jobTypes);
  const claimStarted = Date.now();
  logInfo("jobs.claim_start", { lane, limit, jobTypes: jobTypes ?? [] });
  const params: { p_limit: number; p_job_types?: string[] } = { p_limit: limit };
  if (jobTypes?.length) params.p_job_types = jobTypes;
  const { data, error } = await supabase.rpc("claim_background_jobs", params);

  if (error) {
    throw new Error(error.message || "Could not claim background jobs.");
  }

  const jobs = ((data ?? []) as Parameters<typeof claimedJobFromRow>[0][]).map(claimedJobFromRow);
  logInfo("jobs.claim_complete", {
    lane,
    claimed: jobs.length,
    durationMs: Date.now() - claimStarted,
  });
  const drainStarted = Date.now();
  const processed = await runClaimedJobs(jobs, async (job) => {
    await processJob(job.job_type, jobPayloadFromClaimed(job));
  });
  logInfo("jobs.drain_complete", {
    lane,
    claimed: jobs.length,
    succeeded: processed.succeeded,
    failed: processed.failed,
    durationMs: Date.now() - drainStarted,
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
    .select("id, organization_id, job_type, entity_type, entity_id, created_by, attempt_count, created_at, locked_at, progress")
    .maybeSingle();
  if (error || !data) return null;
  return claimedJobFromRow(data);
}

/** Run just-queued jobs without marking the whole bulk RUNNING first. */
export async function runQueuedJobsNow(jobs: ClaimedJob[]): Promise<DrainResult> {
  const unique = [...new Map(jobs.map((job) => [job.id, job])).values()];
  if (!unique.length || !usesDatabaseJobRunner() || !hasAdminClient()) {
    return { claimed: 0, succeeded: 0, failed: 0 };
  }
  const result: DrainResult = { claimed: 0, succeeded: 0, failed: 0 };
  const bookings = unique.filter((job) => job.job_type === "shipment-booking");
  const rest = unique.filter((job) => job.job_type !== "shipment-booking");
  const run = async (batch: ClaimedJob[], concurrency: number) => {
    await runPool(batch, concurrency, async (job) => {
      const row = await claimQueuedJob(job);
      if (!row) return;
      result.claimed += 1;
      logInfo("jobs.drain_start", {
        jobId: row.id,
        jobType: row.job_type,
        organizationId: row.organization_id,
        attempt: row.attempt_count + 1,
        queueWaitMs: queueWaitMs(row.created_at),
      });
      try {
        await processJob(row.job_type, jobPayloadFromClaimed(row));
        result.succeeded += 1;
      } catch (jobError) {
        result.failed += 1;
        logError("jobs.drain_failed", {
          jobId: row.id,
          jobType: row.job_type,
          organizationId: row.organization_id,
          message: jobError instanceof Error ? jobError.message : "job failed",
        });
      }
    });
  };
  await run(bookings, indiaPostBookingConcurrency());
  await run(rest, restDrainConcurrency(bookings.length));
  return result;
}

/** 1–4 bookings wait in the click. Larger bulks queue and run after the response so the page cannot time out. */
export async function startQueuedBookingJobs(jobs: ClaimedJob[]): Promise<DrainResult> {
  if (!jobs.length) return { claimed: 0, succeeded: 0, failed: 0 };
  if (shouldWaitForQueuedBookings(jobs.length)) {
    return runQueuedJobsNow(jobs);
  }
  const run = () =>
    runQueuedJobsNow(jobs).catch((error) => {
      logError("jobs.bulk_run_failed", {
        count: jobs.length,
        message: error instanceof Error ? error.message : "bulk run failed",
      });
      return { claimed: 0, succeeded: 0, failed: 0 } satisfies DrainResult;
    });
  try {
    const { after } = await import("next/server");
    after(() => {
      void run();
    });
  } catch {
    void run();
  }
  return { claimed: 0, succeeded: 0, failed: 0 };
}
