import { describe, expect, it } from "vitest";
import { forceBookRefusal } from "@/modules/india-post/booking-force-retry";

describe("forceBookRefusal parked booking", () => {
  it("allows an owner to force a queued shipment whose job is held until 2099", () => {
    const refusal = forceBookRefusal({
      role: "OWNER",
      shipment: { id: "shp-1", status: "QUEUED", barcode: "ET214330016IN" },
      job: {
        id: "job-1",
        status: "RETRYING",
        next_attempt_at: "2099-01-01T00:00:00.000Z",
      },
    });
    expect(refusal).toBeNull();
  });

  it("still refuses a queued shipment with a retry due soon", () => {
    const refusal = forceBookRefusal({
      role: "OWNER",
      shipment: { id: "shp-1", status: "QUEUED" },
      job: {
        id: "job-1",
        status: "RETRYING",
        next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(refusal?.kind).toBe("conflict");
  });
});
