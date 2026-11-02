import { describe, expect, it } from "vitest";
import {
  confirmHistoryForBookedShipment,
  recordMerchantBox,
  rejectPackagingHistoryForOrder,
  verifyPackagingHistory,
} from "@/modules/autopack/history";
import { evaluateAutoPack } from "@/modules/autopack/service";
import { buildShipmentComposition } from "@/modules/autopack/composition";
import { memorySupabase } from "@/modules/autopack/memory-supabase.testkit";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function setup(lines: Array<{ variant: string | null; qty: number }> = [{ variant: "111", qty: 2 }]) {
  const db = memorySupabase({
    order_line_items: lines.map((line, index) => ({
      id: `line-${index}`,
      organization_id: ORG,
      order_id: "order-1",
      shopify_variant_id: line.variant,
      title: "Mug",
      sku: null,
      quantity: line.qty,
      unfulfilled_quantity: line.qty,
      requires_shipping: true,
    })),
    external_order_references: [
      { organization_id: ORG, order_id: "order-1", source: "SHOPIFY", shop_domain: "demo.myshopify.com" },
    ],
    automation_settings: [{ organization_id: ORG, auto_package_selection: true }],
  });
  return db;
}

const box = (lengthCm: number, widthCm: number, heightCm: number) => ({ lengthCm, widthCm, heightCm });

function base(overrides: Partial<Parameters<typeof recordMerchantBox>[1]> = {}) {
  return {
    organizationId: ORG,
    userId: USER,
    orderId: "order-1",
    shipmentId: "ship-1",
    box: box(30, 25, 15),
    weightGrams: 800,
    serviceCode: "SP_INLAND_PARCEL",
    packageSource: "custom" as const,
    ...overrides,
  };
}

describe("packaging history capture", () => {
  it("manual custom size is stored as entered with full traceability", async () => {
    const db = setup();
    const result = await recordMerchantBox(db.client, base());
    expect(result.recorded).toBe(true);
    const [row] = db.rows("packaging_history");
    expect(row).toMatchObject({
      organization_id: ORG,
      shop_domain: "demo.myshopify.com",
      order_id: "order-1",
      shipment_id: "ship-1",
      unit_count: 2,
      package_source: "custom",
      evidence_level: "entered",
      entered_by: USER,
      weight_grams: 800,
    });
    expect(row.composition).toEqual([{ variantId: "111", productId: null, sku: null, title: "Mug", qty: 2 }]);
    expect(String(row.composition_key)).toMatch(/^[0-9a-f]{64}$/);
    expect(row.verified_at).toBeUndefined();
  });

  it("preset pick keeps the preset id; measured makes it verified", async () => {
    const db = setup();
    await recordMerchantBox(db.client, base({ packageSource: "preset", presetId: "preset-1", measured: true }));
    expect(db.rows("packaging_history")[0]).toMatchObject({
      package_source: "preset",
      preset_id: "preset-1",
      evidence_level: "verified",
      verified_by: USER,
    });
  });

  it("missing dimensions source data: no variant ids means nothing is learned", async () => {
    const db = setup([{ variant: "111", qty: 1 }, { variant: null, qty: 1 }]);
    const result = await recordMerchantBox(db.client, base());
    expect(result).toMatchObject({ recorded: false, reason: "MISSING_VARIANT_IDS" });
    expect(db.rows("packaging_history")).toHaveLength(0);
  });

  it("a different box for the same items supersedes the old one, so the latest choice wins", async () => {
    const db = setup();
    await recordMerchantBox(db.client, base({ measured: true }));
    await recordMerchantBox(db.client, base({ shipmentId: "ship-2", box: box(32, 25, 15) }));
    const rows = db.rows("packaging_history");
    expect(rows).toHaveLength(2);
    expect(rows[0].superseded_at).toBeTruthy();
    expect(rows[1].superseded_at).toBeFalsy();
    expect(rows[1]).toMatchObject({ evidence_level: "entered", length_cm: 32 });
  });

  it("the same box again reuses the row and never downgrades a verified box", async () => {
    const db = setup();
    await recordMerchantBox(db.client, base({ measured: true }));
    await recordMerchantBox(db.client, base({ shipmentId: "ship-2" }));
    const rows = db.rows("packaging_history");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ evidence_level: "verified", shipment_id: "ship-2" });
  });

  it("booking confirms an entered box only when the booked size still matches", async () => {
    const db = setup();
    await recordMerchantBox(db.client, base());
    await confirmHistoryForBookedShipment(db.client, { organizationId: ORG, shipmentId: "ship-1", box: box(31, 25, 15) });
    expect(db.rows("packaging_history")[0].evidence_level).toBe("entered");
    await confirmHistoryForBookedShipment(db.client, { organizationId: ORG, shipmentId: "ship-1", box: box(30, 25, 15) });
    expect(db.rows("packaging_history")[0]).toMatchObject({ evidence_level: "confirmed" });
    expect(db.rows("packaging_history")[0].confirmed_at).toBeTruthy();
  });

  it("booking a verified box records confirmed_at but keeps it verified", async () => {
    const db = setup();
    await recordMerchantBox(db.client, base({ measured: true }));
    await confirmHistoryForBookedShipment(db.client, { organizationId: ORG, shipmentId: "ship-1", box: box(30, 25, 15) });
    expect(db.rows("packaging_history")[0]).toMatchObject({ evidence_level: "verified" });
    expect(db.rows("packaging_history")[0].confirmed_at).toBeTruthy();
  });

  it("history from another workspace is never used", async () => {
    const db = setup();
    await recordMerchantBox(db.client, base({ measured: true }));
    const composition = buildShipmentComposition([{ variantId: "111", quantity: 2 }]);
    const other = await evaluateAutoPack(db.client, {
      organizationId: OTHER_ORG,
      composition,
      presets: [],
    });
    expect(other.decision).toMatchObject({ kind: "MANUAL_REVIEW_REQUIRED", reason: "NO_HISTORY" });
  });
});

describe("evaluateAutoPack", () => {
  const composition = buildShipmentComposition([{ variantId: "111", quantity: 2 }]);

  it("auto-applies verified history only when the merchant opted in", async () => {
    const db = setup();
    await recordMerchantBox(db.client, base({ measured: true }));
    const on = await evaluateAutoPack(db.client, { organizationId: ORG, orderId: "order-2", composition, presets: [] });
    expect(on.autoChoice).toMatchObject({ source: "autopack_history", lengthCm: 30, widthCm: 25, heightCm: 15 });

    db.rows("automation_settings")[0].auto_package_selection = false;
    const off = await evaluateAutoPack(db.client, { organizationId: ORG, orderId: "order-2", composition, presets: [] });
    expect(off.autoChoice).toBeNull();
    expect(off.decision).toMatchObject({ kind: "CUSTOM_DIMENSIONS", autoApplicable: true });
  });

  it("confirmed-only history is suggested, never auto-applied", async () => {
    const db = setup();
    await recordMerchantBox(db.client, base());
    await confirmHistoryForBookedShipment(db.client, { organizationId: ORG, shipmentId: "ship-1", box: box(30, 25, 15) });
    const result = await evaluateAutoPack(db.client, { organizationId: ORG, orderId: "order-2", composition, presets: [] });
    expect(result.decision).toMatchObject({ kind: "CUSTOM_DIMENSIONS", autoApplicable: false });
    expect(result.autoChoice).toBeNull();
  });

  it("merchant can verify a confirmed box later", async () => {
    const db = setup();
    const { historyId } = await recordMerchantBox(db.client, base());
    await verifyPackagingHistory(db.client, { organizationId: ORG, userId: USER }, historyId as string);
    const result = await evaluateAutoPack(db.client, { organizationId: ORG, orderId: "order-2", composition, presets: [] });
    expect(result.autoChoice).not.toBeNull();
  });

  it("AI recommendation rejection is remembered per order", async () => {
    const db = setup();
    const { historyId } = await recordMerchantBox(db.client, base({ measured: true }));
    await rejectPackagingHistoryForOrder(db.client, { organizationId: ORG, userId: USER }, historyId as string, "order-2");
    const rejected = await evaluateAutoPack(db.client, { organizationId: ORG, orderId: "order-2", composition, presets: [] });
    expect(rejected.decision).toMatchObject({ kind: "MANUAL_REVIEW_REQUIRED", reason: "REJECTED_BY_MERCHANT" });
    expect(rejected.autoChoice).toBeNull();
    const otherOrder = await evaluateAutoPack(db.client, { organizationId: ORG, orderId: "order-3", composition, presets: [] });
    expect(otherOrder.autoChoice).not.toBeNull();
  });

  it("missing table or column reads as no history and flag off", async () => {
    const broken = {
      from: () => {
        throw new Error('relation "packaging_history" does not exist');
      },
    } as never;
    const result = await evaluateAutoPack(broken, { organizationId: ORG, composition, presets: [] });
    expect(result.decision).toMatchObject({ kind: "MANUAL_REVIEW_REQUIRED", reason: "NO_HISTORY" });
    expect(result.autoSelectionEnabled).toBe(false);
  });
});
