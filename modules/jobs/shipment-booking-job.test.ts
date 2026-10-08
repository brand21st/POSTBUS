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

  it("falls back to a table insert when the enqueue RPC is not allowed", async () => {
    const inserted = { id: "job-2", status: "QUEUED", entity_id: "ship-2" };
    const query: Record<string, unknown> = {};
    const self = () => query;
    query.select = self;
    query.eq = self;
    query.in = self;
    query.order = self;
    query.limit = self;
    query.maybeSingle = async () => ({ data: null, error: null });
    query.insert = () => query;
    query.single = async () => ({ data: inserted, error: null });
    const supabase = {
      rpc: async () => ({
        data: null,
        error: { code: "42501", message: "permission denied for function enqueue_shipment_booking_job" },
      }),
      from: () => query,
    };
    const job = await enqueueShipmentBookingJob(supabase as never, {
      organizationId: "org-1",
      jobType: "shipment-booking",
      entityType: "shipment",
      entityId: "ship-2",
    });
    expect(job.id).toBe("job-2");
  });
});
