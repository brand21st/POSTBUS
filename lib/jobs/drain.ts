import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { runPool } from "@/lib/async/pool";
import { indiaPostBookingConcurrency } from "@/modules/india-post/booking-batch";
import { logError, logInfo } from "@/lib/logger";
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
    await processJob(job.job_type, {
      organizationId: job.organization_id,
      jobId: job.id,
      entityType: job.entity_type ?? undefined,
      entityId: job.entity_id ?? undefined,
      shipmentIds: job.progress?.shipmentIds,
      userId: job.created_by ?? undefined,
    });
  });

  return { claimed: jobs.length, ...processed };
}
