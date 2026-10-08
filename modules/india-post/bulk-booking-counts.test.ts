import { describe, expect, it } from "vitest";
import { countsFromShipments } from "@/modules/india-post/bulk-booking";

describe("bulk booking status counts", () => {
  it("does not round 22 booked / 7 retrying / 1 failed", () => {
    const rows = [
      ...Array.from({ length: 22 }, () => ({ status: "MANIFEST_READY" })),
      ...Array.from({ length: 7 }, () => ({ status: "QUEUED", last_error_code: "TEMPORARY_PROVIDER_FAILURE" })),
      { status: "FAILED", last_error_code: "VALIDATION_ERROR" },
    ];
    expect(countsFromShipments(rows)).toMatchObject({
      booked: 22,
      retrying: 7,
      queued: 0,
      failed: 1,
    });
  });

  it("counts RECOVERY_REQUIRED as retrying, not failed", () => {
    expect(
      countsFromShipments([{ status: "RECOVERY_REQUIRED", last_error_code: "ETIMEDOUT" }])
    ).toMatchObject({ retrying: 1, failed: 0, queued: 0 });
  });
});
