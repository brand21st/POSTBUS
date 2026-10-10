import { describe, expect, it } from "vitest";
import {
  isolateBulkTrackingChunk,
  outcomesFromOkChunk,
  type BulkChunkResult,
} from "@/modules/india-post/tracking-bulk";

describe("bulk tracking isolation", () => {
  it("keeps HTTP 200 empty history as absent, not rejected", () => {
    const outcomes = outcomesFromOkChunk(["AW1", "AW2"], []);
    expect(outcomes).toEqual([
      { barcode: "AW1", status: "absent" },
      { barcode: "AW2", status: "absent" },
    ]);
  });

  it("matches found articles by booking_details.article_number only", () => {
    const outcomes = outcomesFromOkChunk(["AW1"], [
      { booking_details: { article_number: "AW2" }, tracking_details: [] },
    ]);
    expect(outcomes[0]?.status).toBe("absent");
  });

  it("splits HTTP 400 batches instead of dropping every AWB", async () => {
    const calls: string[][] = [];
    const fetchChunk = async (batch: string[]): Promise<BulkChunkResult> => {
      calls.push(batch);
      if (batch.length > 1) return { kind: "reject", status: 400, message: "article not found" };
      if (batch[0] === "GOOD") {
        return {
          kind: "ok",
          articles: [
            {
              booking_details: { article_number: "GOOD" },
              tracking_details: [{ event: "Item Dispatched", date: "2026-09-06T03:03:24.411Z" }],
            },
          ],
        };
      }
      return { kind: "reject", status: 400, message: "article not found" };
    };
    const outcomes = await isolateBulkTrackingChunk(["GOOD", "BAD"], fetchChunk, { remaining: 32 });
    expect(calls[0]).toEqual(["GOOD", "BAD"]);
    expect(outcomes).toEqual([
      expect.objectContaining({ barcode: "GOOD", status: "found" }),
      expect.objectContaining({ barcode: "BAD", status: "lookup_rejected", httpStatus: 400 }),
    ]);
  });

  it("stops isolation when the request budget is exhausted", async () => {
    const fetchChunk = async (): Promise<BulkChunkResult> => ({
      kind: "reject",
      status: 400,
      message: "rejected",
    });
    const outcomes = await isolateBulkTrackingChunk(["A", "B", "C", "D"], fetchChunk, { remaining: 1 });
    expect(outcomes.every((row) => row.status === "lookup_rejected")).toBe(true);
    expect(outcomes).toHaveLength(4);
  });
});
