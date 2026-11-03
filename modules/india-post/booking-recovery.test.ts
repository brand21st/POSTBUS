import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueueShipmentBookingJob = vi.fn(async () => ({ id: "job-1" }));

vi.mock("@/modules/jobs/shipment-booking-job", () => ({
  enqueueShipmentBookingJob: (...args: unknown[]) => enqueueShipmentBookingJob(...args),
}));

import { enqueueSameBarcodeRecovery } from "@/modules/india-post/booking-recovery";

function thenable(result: unknown) {
  const query: Record<string, unknown> = {};
  const self = () => query;
  query.select = self;
  query.update = self;
  query.eq = self;
  query.is = self;
  query.in = self;
  query.order = self;
  query.limit = self;
  query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return query;
}

describe("enqueueSameBarcodeRecovery", () => {
  beforeEach(() => {
    enqueueShipmentBookingJob.mockClear();
  });

  it("queues a first barcode for every workspace Recovery Required row with no article", async () => {
    const rows = [
      {
        id: "ship-a",
        organization_id: "org-a",
        status: "RECOVERY_REQUIRED",
        barcode: null,
        tracking_number: null,
        provider_ref: null,
        booked_at: null,
        last_error_code: "BOOKING_REVIEW_REQUIRED",
        metadata: {},
        created_by: "user-a",
      },
      {
        id: "ship-b",
        organization_id: "org-b",
        status: "FAILED",
        barcode: null,
        tracking_number: null,
        provider_ref: null,
        booked_at: null,
        last_error_code: "PRE_POST_TRANSIENT",
        metadata: {},
        created_by: "user-b",
      },
    ];
    let selectCalls = 0;
    const supabase = {
      from() {
        return {
          select() {
            selectCalls += 1;
            return thenable({ data: selectCalls === 1 ? rows : [], error: null });
          },
          update: () => thenable({ data: { id: "ok" }, error: null }),
        };
      },
    };

    await expect(enqueueSameBarcodeRecovery(supabase as never)).resolves.toEqual({ queued: 2 });
    expect(enqueueShipmentBookingJob).toHaveBeenCalledTimes(2);
    expect(enqueueShipmentBookingJob).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ organizationId: "org-a", entityId: "ship-a" })
    );
    expect(enqueueShipmentBookingJob).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ organizationId: "org-b", entityId: "ship-b" })
    );
  });

  it("does not allocate a first barcode when submit intent is already stored", async () => {
    const supabase = {
      from() {
        return {
          select: () =>
            thenable({
              data: [
                {
                  id: "ship-intent",
                  organization_id: "org-1",
                  status: "RECOVERY_REQUIRED",
                  barcode: null,
                  tracking_number: null,
                  provider_ref: null,
                  booked_at: null,
                  metadata: { ceptSubmitIntentAt: "2026-11-01T00:00:00.000Z" },
                },
              ],
              error: null,
            }),
          update: () => thenable({ data: { id: "ok" }, error: null }),
        };
      },
    };

    await expect(enqueueSameBarcodeRecovery(supabase as never)).resolves.toEqual({ queued: 0 });
    expect(enqueueShipmentBookingJob).not.toHaveBeenCalled();
  });
});
