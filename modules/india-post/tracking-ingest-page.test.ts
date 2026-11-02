import { describe, expect, it, vi } from "vitest";
import { applyBulkTrackingOutcomes } from "@/modules/india-post/tracking-ingest-page";

const enqueueTrackingStageSideEffects = vi.fn();
vi.mock("@/modules/india-post/tracking-effects", () => ({
  enqueueTrackingStageSideEffects: (...args: unknown[]) => enqueueTrackingStageSideEffects(...args),
}));

vi.mock("@/modules/india-post/apply-tracking", async () => {
  const actual = await vi.importActual<typeof import("@/modules/india-post/apply-tracking")>(
    "@/modules/india-post/apply-tracking"
  );
  return {
    ...actual,
    ingestBulkTrackingArticle: vi.fn(async () => ({
      snapshot: { id: "s1", organizationId: "org-a", status: "IN_TRANSIT", operationalStatus: "DISPATCHED" },
      orderStatus: null,
      whatsappEvents: [],
    })),
  };
});

describe("applyBulkTrackingOutcomes last_tracked_at semantics", () => {
  it("stamps last_tracked_at only for HTTP-success absent AWBs", async () => {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const supabase = {
      from() {
        return {
          update(patch: Record<string, unknown>) {
            return {
              eq(column: string, value: string) {
                if (column === "id") updates.push({ id: value, patch });
                return this;
              },
            };
          },
        };
      },
    };
    const applied = await applyBulkTrackingOutcomes(supabase as never, {
      organizationId: "org-a",
      shipments: [
        { id: "s-ok", barcode: "AW-OK" },
        { id: "s-bad", barcode: "AW-BAD" },
        { id: "s-found", barcode: "AW-FOUND" },
      ],
      outcomes: [
        { barcode: "AW-OK", status: "absent" },
        { barcode: "AW-BAD", status: "lookup_rejected", httpStatus: 400, message: "article not found" },
        {
          barcode: "AW-FOUND",
          status: "found",
          article: {
            booking_details: { article_number: "AW-FOUND" },
            tracking_details: [{ event: "Item Delivered(Addressee)", date: "2026-09-07T15:24:12Z" }],
          },
        },
      ],
    });
    expect(applied).toEqual({ ingested: 1, absent: 1, rejected: 1 });
    expect(updates.map((row) => row.id)).toEqual(["s-ok"]);
    expect(enqueueTrackingStageSideEffects).not.toHaveBeenCalled();
  });
});
