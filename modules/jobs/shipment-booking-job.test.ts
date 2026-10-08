import { describe, expect, it, vi } from "vitest";
import { enqueueShipmentBookingJob } from "@/modules/jobs/shipment-booking-job";

vi.mock("@/lib/env", () => ({ usesDatabaseJobRunner: () => true }));

describe("enqueueShipmentBookingJob", () => {
  it("returns the existing active job instead of inserting a duplicate", async () => {
    const existing = { id: "job-1", status: "QUEUED", entity_id: "ship-1" };
    const insert = vi.fn();
    const supabase = {
      rpc: async () => ({ data: existing, error: null }),
      from: () => ({ insert }),
    };
    const first = await enqueueShipmentBookingJob(supabase as never, {
      organizationId: "org-1",
      jobType: "shipment-booking",
      entityType: "shipment",
      entityId: "ship-1",
    });
    const second = await enqueueShipmentBookingJob(supabase as never, {
      organizationId: "org-1",
      jobType: "shipment-booking",
      entityType: "shipment",
      entityId: "ship-1",
    });
    expect(first.id).toBe("job-1");
    expect(second.id).toBe("job-1");
    expect(insert).not.toHaveBeenCalled();
  });
});
