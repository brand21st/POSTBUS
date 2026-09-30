import { describe, expect, it } from "vitest";
import { runClaimedJobs, type ClaimedJob } from "@/lib/jobs/drain";

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

describe("runClaimedJobs", () => {
  it("runs booking jobs before label jobs", async () => {
    const order: string[] = [];
    await runClaimedJobs(
      [
        job({ id: "label-1", job_type: "label-generation", entity_id: "s1" }),
        job({ id: "book-1", job_type: "shipment-booking", entity_id: "s1" }),
        job({ id: "book-2", job_type: "shipment-booking", entity_id: "s2" }),
      ],
      async (claimed) => {
        order.push(claimed.id);
      }
    );
    expect(order.slice(0, 2).sort()).toEqual(["book-1", "book-2"]);
    expect(order[2]).toBe("label-1");
  });
});
