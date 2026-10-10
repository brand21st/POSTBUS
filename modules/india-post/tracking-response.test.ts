import { describe, expect, it } from "vitest";
import {
  articlesForRequestedBarcodes,
  parseBulkTrackingResponse,
  retryAfterMsFromHeader,
} from "@/modules/india-post/tracking-response";

describe("parseBulkTrackingResponse", () => {
  it("accepts a documented success payload", () => {
    const parsed = parseBulkTrackingResponse({
      status_code: 200,
      success: true,
      message: "data retrieved successfully",
      data: [
        {
          booking_details: { article_number: "RK775227016IN" },
          tracking_details: [{ date: "2026-09-07T15:24:12Z", time: "15:24:12", event: "Item Booked", rts: false }],
          del_status: { del_status: "not delivered" },
        },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.[0]?.booking_details?.article_number).toBe("RK775227016IN");
  });

  it("rejects a non-object body", () => {
    expect(() => parseBulkTrackingResponse("nope")).toThrow(/schema is invalid/);
  });

  it("parses success false without treating it as schema success", () => {
    const parsed = parseBulkTrackingResponse({
      success: false,
      status_code: 503,
      message: "upstream unavailable",
      data: [],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.status_code).toBe(503);
  });
});

describe("articlesForRequestedBarcodes", () => {
  it("drops articles that were not requested", () => {
    const kept = articlesForRequestedBarcodes(
      [
        { booking_details: { article_number: "OTHERIN" } },
        { booking_details: { article_number: "AW1" } },
      ],
      ["AW1"]
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.booking_details?.article_number).toBe("AW1");
  });

  it("keeps a single article with scans when the article number is omitted", () => {
    const kept = articlesForRequestedBarcodes(
      [{ tracking_details: [{ event: "Item Booked", date: "2026-10-09", time: "11:33:44" }] }],
      ["CX075250656IN"]
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.tracking_details?.[0]?.event).toBe("Item Booked");
  });

  it("matches a top-level article_number case-insensitively", () => {
    const kept = articlesForRequestedBarcodes(
      [{ article_number: "cx075250656in", tracking_details: [{ event: "Item Dispatched" }] }],
      ["CX075250656IN"]
    );
    expect(kept).toHaveLength(1);
  });
});

describe("retryAfterMsFromHeader", () => {
  it("parses integer seconds", () => {
    expect(retryAfterMsFromHeader("12")).toBe(12000);
  });
});
