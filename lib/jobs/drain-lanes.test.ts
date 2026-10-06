import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const processJob = vi.fn();
const runPool = vi.fn(
  async (
    items: unknown[],
    _concurrency: number,
    worker: (item: unknown, index: number) => Promise<void>
  ) => {
    for (let index = 0; index < items.length; index += 1) {
      await worker(items[index], index);
    }
  }
);

vi.mock("@/lib/supabase/admin", () => ({
  hasAdminClient: () => true,
  createAdminClient: () => ({ rpc }),
}));

vi.mock("@/workers/processor", () => ({
  processJob: (...args: unknown[]) => processJob(...args),
}));

vi.mock("@/lib/async/pool", () => ({
  runPool: (...args: unknown[]) => runPool(...(args as [unknown[], number, (item: unknown, index: number) => Promise<void>])),
}));

import { drainDueJobs, runClaimedJobs, type ClaimedJob } from "@/lib/jobs/drain";

function job(partial: Partial<ClaimedJob> & Pick<ClaimedJob, "id" | "job_type">): ClaimedJob {
  return {
    organization_id: "org-1",
    entity_type: "shipment",
    entity_id: partial.entity_id ?? partial.id,
    created_by: null,
    attempt_count: 0,
    ...partial,
  };
}

describe("drainDueJobs typed claim", () => {
  beforeEach(() => {
    rpc.mockReset();
    processJob.mockReset();
    runPool.mockClear();
    processJob.mockResolvedValue(undefined);
  });

  it("omits p_job_types when the drain is unfiltered", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await drainDueJobs(10);
    expect(rpc).toHaveBeenCalledWith("claim_background_jobs", { p_limit: 10 });
  });

  it("passes p_job_types when filtered", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await drainDueJobs(8, ["label-generation"]);
    expect(rpc).toHaveBeenCalledWith("claim_background_jobs", {
      p_limit: 8,
      p_job_types: ["label-generation"],
    });
  });

  it.each([1, 5, 10, 25])("records claimed/completed counts for %s mocked jobs", async (count) => {
    rpc.mockResolvedValueOnce({
      data: Array.from({ length: count }, (_, index) => ({
        id: `job-${index}`,
        organization_id: "org-1",
        job_type: "label-generation",
        entity_type: "shipment",
        entity_id: `s-${index}`,
        attempt_count: 0,
      })),
      error: null,
    });
    const result = await drainDueJobs(count, ["label-generation"]);
    expect(result).toEqual({ claimed: count, succeeded: count, failed: 0 });
    expect(processJob).toHaveBeenCalledTimes(count);
  });
});

describe("runClaimedJobs concurrency", () => {
  beforeEach(() => {
    runPool.mockClear();
  });

  it("runs a labels-only batch at concurrency 4", async () => {
    await runClaimedJobs(
      [
        job({ id: "label-1", job_type: "label-generation" }),
        job({ id: "label-2", job_type: "label-generation" }),
      ],
      async () => undefined
    );
    const restCall = runPool.mock.calls.find((call) => (call[0] as ClaimedJob[])[0]?.job_type === "label-generation");
    expect(restCall?.[1]).toBe(4);
  });

  it("still runs bookings first then the rest at concurrency 2 in a mixed batch", async () => {
    const order: string[] = [];
    await runClaimedJobs(
      [
        job({ id: "label-1", job_type: "label-generation" }),
        job({ id: "book-1", job_type: "shipment-booking" }),
      ],
      async (claimed) => {
        order.push(claimed.id);
      }
    );
    expect(order).toEqual(["book-1", "label-1"]);
    expect(runPool.mock.calls[0]?.[1]).toBe(4);
    expect(runPool.mock.calls[1]?.[1]).toBe(2);
  });
});
