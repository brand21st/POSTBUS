import { describe, expect, it } from "vitest";
import { enqueueTrackingStageSideEffects } from "@/modules/india-post/tracking-effects";
import {
  applyReconcileWrites,
  assertReconcileTargetIsolated,
  dryRunShipmentReconcile,
} from "@/modules/ndr-rto/reconcile";

describe("historical dry-run reconciliation", () => {
  it("proposes DELIVERED from Item Delivered(Addressee) without writing", () => {
    const result = dryRunShipmentReconcile({
      shipmentId: "ship-a",
      organizationId: "org-a",
      current: {
        status: "IN_TRANSIT",
        operationalStatus: null,
        lastEventAt: "2026-09-03T08:00:00.000Z",
        ndrAttemptCount: 0,
        rtoInitiatedAt: null,
        ndrReason: null,
        rtoReason: null,
        deliveredAt: null,
        ambiguous: false,
      },
      events: [
        {
          eventCode: "ITEM_DELIVERED",
          eventDescription: "Item Delivered(Addressee)",
          occurredAt: "2026-09-03T08:00:00.000Z",
        },
      ],
    });
    expect(result.proposedOperationalStatus).toBe("DELIVERED");
    expect(result.terminalChange).toBe(true);
    expect(result.before.operationalStatus).toBeNull();
  });

  it("does not propose NDR for Item Kept on Hold", () => {
    const result = dryRunShipmentReconcile({
      shipmentId: "ship-b",
      organizationId: "org-a",
      current: {
        status: "IN_TRANSIT",
        operationalStatus: null,
        lastEventAt: "2026-09-03T08:00:00.000Z",
        ndrAttemptCount: 0,
        rtoInitiatedAt: null,
        ndrReason: null,
        rtoReason: null,
        deliveredAt: null,
        ambiguous: false,
      },
      events: [
        {
          eventCode: "ITEM_HOLD",
          eventDescription: "Item Kept on Hold",
          occurredAt: "2026-09-03T08:00:00.000Z",
        },
      ],
    });
    expect(result.proposedOperationalStatus).toBeNull();
    expect(result.ambiguous).toBe(true);
  });

  it("does not treat FAILED booking shipments as tracking-eligible", () => {
    const result = dryRunShipmentReconcile({
      shipmentId: "ship-fail",
      organizationId: "org-a",
      current: {
        status: "FAILED",
        operationalStatus: null,
        lastEventAt: null,
        ndrAttemptCount: 0,
        rtoInitiatedAt: null,
        ndrReason: null,
        rtoReason: null,
        deliveredAt: null,
        ambiguous: false,
      },
      events: [
        {
          eventCode: "ITEM_DELIVERED",
          eventDescription: "Item Delivered(Addressee)",
          occurredAt: "2026-09-03T08:00:00.000Z",
        },
      ],
    });
    expect(result.terminalChange).toBe(false);
    expect(result.proposedOperationalStatus).toBeNull();
  });

  it("hard-blocks the production Supabase project", () => {
    expect(() => assertReconcileTargetIsolated("https://hgacoeoovjxkzfbesmvl.supabase.co")).toThrow(/STOP/);
    expect(() => assertReconcileTargetIsolated("postgresql://127.0.0.1:55432/postbus_staging")).not.toThrow();
  });

  it("refuses apply writes until explicit approval", () => {
    expect(() => applyReconcileWrites()).toThrow(/not authorized/);
  });

  it("does not import or call tracking side effects from the reconcile module", () => {
    expect(typeof enqueueTrackingStageSideEffects).toBe("function");
    expect(String(dryRunShipmentReconcile)).not.toContain("enqueueTrackingStageSideEffects");
  });
});
