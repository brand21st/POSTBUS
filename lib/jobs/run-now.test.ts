import { beforeEach, describe, expect, it, vi } from "vitest";

const maybeSingle = vi.fn();
const processJob = vi.fn();

vi.mock("@/lib/env", () => ({
  usesDatabaseJobRunner: () => true,
  env: { jobRunner: "database", indiaPostBookingConcurrency: "4" },
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasAdminClient: () => true,
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

describe("runQueuedJobsNow", () => {
  beforeEach(() => {
    maybeSingle.mockReset();
    processJob.mockReset();
  });

  it("claims a queued booking job and runs it immediately", async () => {
    maybeSingle.mockResolvedValueOnce({
      data: {
        id: "job-1",
        organization_id: "org-1",
        job_type: "shipment-booking",
        entity_type: "shipment",
        entity_id: "s1",
        created_by: "user-1",
        attempt_count: 0,
        progress: {},
      },
      error: null,
    });
    processJob.mockResolvedValueOnce(undefined);
    const { runQueuedJobsNow } = await import("@/lib/jobs/drain");
    const result = await runQueuedJobsNow([
      {
        id: "job-1",
        organization_id: "org-1",
        job_type: "shipment-booking",
        entity_type: "shipment",
        entity_id: "s1",
        created_by: "user-1",
        attempt_count: 0,
        progress: {},
      },
    ]);
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

  it("skips when another runner already claimed the job", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const { runQueuedJobsNow } = await import("@/lib/jobs/drain");
    const result = await runQueuedJobsNow([
      {
        id: "job-1",
        organization_id: "org-1",
        job_type: "shipment-booking",
        entity_type: "shipment",
        entity_id: "s1",
        created_by: null,
        attempt_count: 0,
      },
    ]);
    expect(result).toEqual({ claimed: 0, succeeded: 0, failed: 0 });
    expect(processJob).not.toHaveBeenCalled();
  });
});
