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

  it("keeps a lone article with scans when CEPT labels it differently", () => {
    const kept = articlesForRequestedBarcodes(
      [
        {
          booking_details: { article_number: "UNKNOWN" },
          tracking_details: [{ event: "Item Booked", date: "2026-10-16T00:00:00Z", time: "11:04:20" }],
        },
      ],
      ["CX075364450IN"]
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.tracking_details?.[0]?.event).toBe("Item Booked");
  });
});

describe("India Post public tracking payload aliases", () => {
  it("normalizes DD/MM/YYYY scans into date, time, event, and office", () => {
    const parsed = parseBulkTrackingResponse({
      success: true,
      data: {
        article_number: "CX075364503IN",
        trackingDetails: [
          {
            event_date: "16/10/2026",
            event_time: "11:04:20",
            event_description: "Item Booked",
            event_office_name: "Kozhikode PH",
          },
          {
            event_date: "17/10/2026",
            event_time: "07:53:51",
            event_description: "Item Dispatched",
            event_office_name: "Palakkad TMO",
          },
        ],
      },
    });
    expect(parsed.data?.[0]?.tracking_details).toHaveLength(2);
    expect(parsed.data?.[0]?.tracking_details?.[0]).toMatchObject({
      date: "16/10/2026",
      time: "11:04:20",
      event: "Item Booked",
      office: "Kozhikode PH",
    });
  });

  it("reads scans from an Articles envelope and a raw event list", () => {
    const fromArticles = parseBulkTrackingResponse({
      success: true,
      Articles: [
        {
          booking_details: { articleNumber: "CX075364450IN" },
          tracking_details: [{ date: "2026-10-16T00:00:00Z", time: "11:04:20", event: "Item Booked" }],
        },
      ],
    });
    expect(fromArticles.data?.[0]?.tracking_details?.[0]?.event).toBe("Item Booked");

    const fromEvents = parseBulkTrackingResponse({
      success: true,
      data: [
        { date: "2026-10-16T00:00:00Z", time: "11:04:20", event: "Item Booked", office: "Kozhikode PH" },
        { date: "2026-10-16T00:00:00Z", time: "11:39:44", event: "Item bagged", office: "Kozhikode PH" },
      ],
    });
    expect(fromEvents.data?.[0]?.tracking_details).toHaveLength(2);
  });
});

describe("retryAfterMsFromHeader", () => {
  it("parses integer seconds", () => {
    expect(retryAfterMsFromHeader("12")).toBe(12000);
  });
});
