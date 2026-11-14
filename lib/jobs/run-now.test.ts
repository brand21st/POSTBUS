import { beforeEach, describe, expect, it, vi } from "vitest";

const maybeSingle = vi.fn();
const processJob = vi.fn();
const usesDatabaseJobRunner = vi.hoisted(() => vi.fn(() => true));
const hasAdminClient = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/env", () => ({
  usesDatabaseJobRunner: () => usesDatabaseJobRunner(),
  env: { jobRunner: "database", indiaPostBookingConcurrency: "4" },
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasAdminClient: () => hasAdminClient(),
  createAdminClient: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({
          in: () => ({
            select: () => ({ maybeSingle }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/workers/processor", () => ({
  processJob: (...args: unknown[]) => processJob(...args),
}));

const queuedBooking = {
  id: "job-1",
  organization_id: "org-1",
  job_type: "shipment-booking",
  entity_type: "shipment",
  entity_id: "s1",
  created_by: "user-1",
  attempt_count: 0,
  progress: {},
};

describe("runQueuedJobsNow", () => {
  beforeEach(() => {
    maybeSingle.mockReset();
    processJob.mockReset();
    usesDatabaseJobRunner.mockReset();
    usesDatabaseJobRunner.mockReturnValue(true);
    hasAdminClient.mockReset();
    hasAdminClient.mockReturnValue(true);
  });

  it("claims a queued booking job and runs it immediately", async () => {
    maybeSingle.mockResolvedValueOnce({ data: queuedBooking, error: null });
    processJob.mockResolvedValueOnce(undefined);
    const { runQueuedJobsNow } = await import("@/lib/jobs/drain");
    const result = await runQueuedJobsNow([queuedBooking]);
    expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0 });
    expect(processJob).toHaveBeenCalledWith("shipment-booking", {
      organizationId: "org-1",
      jobId: "job-1",
      entityType: "shipment",
      entityId: "s1",
      shipmentIds: undefined,
      userId: "user-1",
      attempt: 0,
    });
  });

  it("still runs Direct Book in this process when BullMQ owns the cron drain", async () => {
    usesDatabaseJobRunner.mockReturnValue(false);
    maybeSingle.mockResolvedValueOnce({ data: queuedBooking, error: null });
    processJob.mockResolvedValueOnce(undefined);
    const { runQueuedJobsNow } = await import("@/lib/jobs/drain");
    const result = await runQueuedJobsNow([queuedBooking]);
    expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0 });
    expect(processJob).toHaveBeenCalledOnce();
  });

  it("fails the booking request when the service role client is missing", async () => {
    hasAdminClient.mockReturnValue(false);
    const { runQueuedJobsNow, startQueuedBookingJobs } = await import("@/lib/jobs/drain");
    await expect(runQueuedJobsNow([queuedBooking])).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    await expect(startQueuedBookingJobs([queuedBooking])).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(processJob).not.toHaveBeenCalled();
  });

  it("skips when another runner already claimed the job", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const { runQueuedJobsNow } = await import("@/lib/jobs/drain");
    const result = await runQueuedJobsNow([
      {
        ...queuedBooking,
        created_by: null,
      },
    ]);
    expect(result).toEqual({ claimed: 0, succeeded: 0, failed: 0 });
    expect(processJob).not.toHaveBeenCalled();
  });
});
