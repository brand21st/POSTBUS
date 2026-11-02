import { describe, expect, it } from "vitest";
import { buildShipmentComposition, compositionKey, normalizeShopifyId } from "@/modules/autopack/composition";
import { decidePackage, historyDecisionChoice, type PackagingHistoryRow } from "@/modules/autopack/decide";
import { manualDimensionLock, parcelDimensionsMetadata } from "@/modules/shopify/dimensions";

const SERVICE = "SP_INLAND_PARCEL";

function comp(lines: Array<[string | number | null, number]>) {
  return buildShipmentComposition(lines.map(([variantId, quantity]) => ({ variantId, quantity })));
}

function keyOf(lines: Array<[string | number, number]>) {
  const composition = comp(lines);
  if (!composition.ok) throw new Error("bad composition");
  return composition.key;
}

let seq = 0;
function history(
  key: string,
  box: [number, number, number],
  level: PackagingHistoryRow["evidenceLevel"],
  extra: Partial<PackagingHistoryRow> = {}
): PackagingHistoryRow {
  seq += 1;
  return {
    id: `11111111-1111-4111-8111-${String(seq).padStart(12, "0")}`,
    compositionKey: key,
    lengthCm: box[0],
    widthCm: box[1],
    heightCm: box[2],
    serviceCode: SERVICE,
    packageSource: "custom",
    presetId: null,
    evidenceLevel: level,
    createdAt: `2026-10-${String(10 + seq).padStart(2, "0")}T00:00:00.000Z`,
    supersededAt: null,
    ...extra,
  };
}

describe("composition", () => {
  it("normalizes Shopify ids from numbers, strings and GIDs", () => {
    expect(normalizeShopifyId(123)).toBe("123");
    expect(normalizeShopifyId("gid://shopify/ProductVariant/456")).toBe("456");
    expect(normalizeShopifyId("")).toBeNull();
    expect(normalizeShopifyId("abc")).toBeNull();
    expect(normalizeShopifyId(0)).toBeNull();
  });

  it("is order independent and merges repeated variants", () => {
    expect(keyOf([["1", 1], ["2", 2]])).toBe(keyOf([["2", 2], ["1", 1]]));
    expect(keyOf([["1", 1], ["1", 1]])).toBe(keyOf([["1", 2]]));
    expect(keyOf([["gid://shopify/ProductVariant/1", 1]])).toBe(keyOf([[1, 1]]));
  });

  it("ignores title and SKU changes", () => {
    const a = buildShipmentComposition([{ variantId: 9, quantity: 1, title: "Mug", sku: "M-1" }]);
    const b = buildShipmentComposition([{ variantId: 9, quantity: 1, title: "Mug v2", sku: "" }]);
    expect(a.ok && b.ok && a.key === b.key).toBe(true);
  });

  it("different quantities give different keys", () => {
    expect(keyOf([["1", 1]])).not.toBe(keyOf([["1", 2]]));
    expect(compositionKey([{ variantId: "1", qty: 2 }])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses to match when any shippable line has no variant id", () => {
    expect(comp([["1", 1], [null, 1]])).toEqual({ ok: false, reason: "MISSING_VARIANT_IDS" });
  });

  it("skips non-shipping and fully fulfilled lines", () => {
    const composition = buildShipmentComposition([
      { variantId: 1, quantity: 1 },
      { variantId: null, quantity: 1, requiresShipping: false },
      { variantId: 3, quantity: 0 },
    ]);
    expect(composition.ok && composition.items.map((item) => item.variantId)).toEqual(["1"]);
    expect(comp([])).toEqual({ ok: false, reason: "EMPTY_SHIPMENT" });
  });
});

describe("decidePackage", () => {
  const twoMugs = comp([["11", 2]]);
  const twoMugsKey = keyOf([["11", 2]]);

  it("existing preset package: the single-preset rule still returns SAVED_PACKAGE", () => {
    const decision = decidePackage({
      composition: comp([["11", 1]]),
      history: [],
      presets: [{ id: "p1", name: "Small", lengthCm: 20, widthCm: 15, heightCm: 10 }],
      serviceCode: SERVICE,
      fallback: { lengthCm: 20, widthCm: 15, heightCm: 10, source: "postbus_package", packageId: "p1", packageName: "Small" },
    });
    expect(decision).toMatchObject({ kind: "SAVED_PACKAGE", presetId: "p1", evidence: { type: "preset" } });
  });

  it("historical custom size reuse: verified exact match is auto-applicable CUSTOM_DIMENSIONS", () => {
    const row = history(twoMugsKey, [30, 25, 15], "verified");
    const decision = decidePackage({ composition: twoMugs, history: [row], presets: [], serviceCode: SERVICE });
    expect(decision).toMatchObject({
      kind: "CUSTOM_DIMENSIONS",
      box: { lengthCm: 30, widthCm: 25, heightCm: 15 },
      evidence: { type: "history", historyId: row.id, level: "verified" },
      autoApplicable: true,
    });
    expect(historyDecisionChoice(decision)).toMatchObject({ source: "autopack_history", evidenceId: row.id });
  });

  it("historical size does not have to be a saved preset, but maps to one when it still matches", () => {
    const row = history(twoMugsKey, [30, 25, 15], "verified", { packageSource: "preset", presetId: "p9" });
    const withPreset = decidePackage({
      composition: twoMugs,
      history: [row],
      presets: [{ id: "p9", name: "Mug box", lengthCm: 30, widthCm: 25, heightCm: 15 }],
      serviceCode: SERVICE,
    });
    expect(withPreset).toMatchObject({ kind: "SAVED_PACKAGE", presetId: "p9", autoApplicable: true });
    const presetChanged = decidePackage({
      composition: twoMugs,
      history: [row],
      presets: [{ id: "p9", name: "Mug box", lengthCm: 31, widthCm: 25, heightCm: 15 }],
      serviceCode: SERVICE,
    });
    expect(presetChanged).toMatchObject({ kind: "CUSTOM_DIMENSIONS", box: { lengthCm: 30 } });
  });

  it("confirmed-only history is recommended but never auto-applied", () => {
    const decision = decidePackage({
      composition: twoMugs,
      history: [history(twoMugsKey, [30, 25, 15], "confirmed")],
      presets: [],
      serviceCode: SERVICE,
    });
    expect(decision).toMatchObject({ kind: "CUSTOM_DIMENSIONS", autoApplicable: false });
    expect(historyDecisionChoice(decision)).not.toBeNull();
  });

  it("entered-only history is never a decision", () => {
    const decision = decidePackage({
      composition: twoMugs,
      history: [history(twoMugsKey, [30, 25, 15], "entered")],
      presets: [],
      serviceCode: SERVICE,
    });
    expect(decision).toMatchObject({ kind: "MANUAL_REVIEW_REQUIRED", reason: "UNCONFIRMED_HISTORY" });
  });

  it("different quantities do not match and are not scaled", () => {
    const decision = decidePackage({
      composition: comp([["11", 3]]),
      history: [history(twoMugsKey, [30, 25, 15], "verified")],
      presets: [],
      serviceCode: SERVICE,
    });
    expect(decision).toMatchObject({ kind: "MANUAL_REVIEW_REQUIRED", reason: "NO_HISTORY" });
  });

  it("multiple products match only the exact same set and quantities", () => {
    const key = keyOf([["11", 1], ["22", 2]]);
    const rows = [history(key, [35, 30, 20], "verified")];
    const same = decidePackage({ composition: comp([["22", 2], ["11", 1]]), history: rows, presets: [], serviceCode: SERVICE });
    expect(same).toMatchObject({ kind: "CUSTOM_DIMENSIONS", autoApplicable: true });
    for (const lines of [[["11", 1]], [["11", 1], ["22", 2], ["33", 1]], [["11", 1], ["22", 1]]] as Array<Array<[string, number]>>) {
      const other = decidePackage({ composition: comp(lines), history: rows, presets: [], serviceCode: SERVICE });
      expect(other.kind).toBe("MANUAL_REVIEW_REQUIRED");
    }
  });

  it("manual override is preserved: merchant-entered sizes are never replaced", () => {
    const rows = [history(twoMugsKey, [30, 25, 15], "verified")];
    for (const source of ["postbus", "manual", "postbus_preset", "postbus_custom"]) {
      const decision = decidePackage({
        shipment: { status: "DRAFT", metadata: { parcelDimensions: { source } } },
        composition: twoMugs,
        history: rows,
        presets: [],
        serviceCode: SERVICE,
      });
      expect(decision).toEqual({ kind: "KEEP_EXISTING", reason: "MERCHANT_OVERRIDE" });
    }
    const accepted = parcelDimensionsMetadata({
      lengthCm: 30,
      widthCm: 25,
      heightCm: 15,
      source: "autopack_history",
      evidenceId: rows[0].id,
      merchantAccepted: true,
    });
    expect(manualDimensionLock("autopack_history", { parcelDimensions: accepted })).toBe(true);
    expect(manualDimensionLock("autopack_history")).toBe(false);
  });

  it("merchant rejection stops the suggestion for that order", () => {
    const row = history(twoMugsKey, [30, 25, 15], "verified");
    const decision = decidePackage({
      composition: twoMugs,
      history: [row],
      presets: [],
      serviceCode: SERVICE,
      rejectedEvidenceIds: [row.id],
    });
    expect(decision).toMatchObject({ kind: "MANUAL_REVIEW_REQUIRED", reason: "REJECTED_BY_MERCHANT" });
  });

  it("missing variant ids or no evidence: never invents a box", () => {
    const missing = decidePackage({ composition: comp([[null, 2]]), history: [], presets: [], serviceCode: SERVICE });
    expect(missing).toMatchObject({ kind: "MANUAL_REVIEW_REQUIRED", reason: "MISSING_VARIANT_IDS" });
    const none = decidePackage({ composition: twoMugs, history: [], presets: [], serviceCode: SERVICE });
    expect(none).toMatchObject({ kind: "MANUAL_REVIEW_REQUIRED", reason: "NO_HISTORY" });
  });

  it("conflicting live history goes to review", () => {
    const decision = decidePackage({
      composition: twoMugs,
      history: [history(twoMugsKey, [30, 25, 15], "verified"), history(twoMugsKey, [32, 25, 15], "verified")],
      presets: [],
      serviceCode: SERVICE,
    });
    expect(decision).toMatchObject({ kind: "MANUAL_REVIEW_REQUIRED", reason: "CONFLICTING_HISTORY" });
  });

  it("superseded rows are ignored", () => {
    const decision = decidePackage({
      composition: twoMugs,
      history: [history(twoMugsKey, [30, 25, 15], "verified", { supersededAt: "2026-10-30T00:00:00.000Z" })],
      presets: [],
      serviceCode: SERVICE,
    });
    expect(decision).toMatchObject({ kind: "MANUAL_REVIEW_REQUIRED", reason: "NO_HISTORY" });
  });

  it("India Post validation: same limits for history, presets and fallbacks", () => {
    const docService = decidePackage({
      composition: twoMugs,
      history: [history(twoMugsKey, [30, 25, 15], "verified")],
      presets: [],
      serviceCode: "SP_INLAND_DOC",
    });
    expect(docService).toMatchObject({ kind: "MANUAL_REVIEW_REQUIRED", reason: "INVALID_FOR_SERVICE" });
    const tooSmall = decidePackage({
      composition: twoMugs,
      history: [history(twoMugsKey, [10, 9, 1], "verified")],
      presets: [],
      serviceCode: SERVICE,
    });
    expect(tooSmall).toMatchObject({ kind: "MANUAL_REVIEW_REQUIRED", reason: "INVALID_FOR_SERVICE" });
    const badFallback = decidePackage({
      composition: comp([["11", 1]]),
      history: [],
      presets: [],
      serviceCode: SERVICE,
      fallback: { lengthCm: 5, widthCm: 5, heightCm: 5, source: "shopify" },
    });
    expect(badFallback).toMatchObject({ kind: "MANUAL_REVIEW_REQUIRED", reason: "NO_HISTORY" });
  });

  it("no duplicate booking: never decides for shipments the booking pipeline owns", () => {
    const rows = [history(twoMugsKey, [30, 25, 15], "verified")];
    const locked = [
      { status: "QUEUED" },
      { status: "BOOKING" },
      { status: "RECOVERY_REQUIRED" },
      { status: "BOOKED", bookedAt: "2026-10-30T00:00:00.000Z" },
      { status: "FAILED", barcode: "EK123456789IN" },
      { status: "DRAFT", bookedAt: "2026-10-30T00:00:00.000Z" },
    ];
    for (const shipment of locked) {
      const decision = decidePackage({ shipment, composition: twoMugs, history: rows, presets: [], serviceCode: SERVICE });
      expect(decision).toEqual({ kind: "KEEP_EXISTING", reason: "SHIPMENT_LOCKED" });
    }
    const draft = decidePackage({
      shipment: { status: "DRAFT", metadata: { parcelDimensions: { source: "postbus_default" } } },
      composition: twoMugs,
      history: rows,
      presets: [],
      serviceCode: SERVICE,
    });
    expect(draft).toMatchObject({ kind: "CUSTOM_DIMENSIONS", autoApplicable: true });
  });
});
