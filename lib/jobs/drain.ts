import { createAdminClient } from "@/lib/supabase/admin";
import { logError, logInfo } from "@/lib/logger";
import { processJob } from "@/workers/processor";

export const DEFAULT_DRAIN_LIMIT = 5;

type ClaimedJob = {
  id: string;
  organization_id: string;
  job_type: string;
  entity_type: string | null;
  entity_id: string | null;
  created_by: string | null;
  attempt_count: number;
};

export type DrainResult = {
  claimed: number;
  succeeded: number;
  failed: number;
};

export async function drainDueJobs(limit = DEFAULT_DRAIN_LIMIT): Promise<DrainResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("claim_background_jobs", { p_limit: limit });

  if (error) {
    throw new Error(error.message || "Could not claim background jobs.");
  }

  const jobs = (data ?? []) as ClaimedJob[];
  const result: DrainResult = { claimed: jobs.length, succeeded: 0, failed: 0 };

  for (const job of jobs) {
    logInfo("jobs.drain_start", {
      jobId: job.id,
      jobType: job.job_type,
      organizationId: job.organization_id,
      attempt: job.attempt_count + 1,
    });

    try {
      // processJob records SUCCEEDED / RETRYING / FAILED on the job row itself.
      await processJob(job.job_type, {
        organizationId: job.organization_id,
        jobId: job.id,
        entityType: job.entity_type ?? undefined,
        entityId: job.entity_id ?? undefined,
        userId: job.created_by ?? undefined,
      });
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
  }

  return result;
}
