import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logInfo } from "@/lib/logger";
import { compositionFromOrderLines, type ShipmentComposition } from "@/modules/autopack/composition";
import { sameBox, type EvidenceLevel, type PackagingHistoryRow } from "@/modules/autopack/decide";
import type { CmBox } from "@/modules/shopify/dimensions";

/**
 * packaging_history reads and writes.
 * Every write is best-effort from the caller's point of view: a missing table
 * (migration not applied yet) must never block a merchant's dimension save or a booking.
 */

const HISTORY_COLUMNS =
  "id, composition_key, composition, unit_count, length_cm, width_cm, height_cm, weight_grams, service_code, package_source, preset_id, evidence_level, entered_by, entered_at, confirmed_at, verified_by, verified_at, superseded_at, rejected_order_ids, created_at, order_id, shipment_id, shop_domain";

type HistoryDbRow = {
  id: string;
  composition_key: string;
  composition: unknown;
  unit_count: number;
  length_cm: number | string;
  width_cm: number | string;
  height_cm: number | string;
  weight_grams: number | null;
  service_code: string;
  package_source: string;
  preset_id: string | null;
  evidence_level: string;
  entered_by: string | null;
  entered_at: string;
  confirmed_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  superseded_at: string | null;
  rejected_order_ids?: string[] | null;
  created_at: string;
  order_id: string | null;
  shipment_id: string | null;
  shop_domain: string | null;
};

export type PackagingHistoryRecord = PackagingHistoryRow & {
  composition: unknown;
  unitCount: number;
  weightGrams: number | null;
  enteredAt: string;
  confirmedAt: string | null;
  verifiedAt: string | null;
  orderId: string | null;
  shipmentId: string | null;
  shopDomain: string | null;
  rejectedOrderIds: string[];
};

function evidenceLevel(value: string): EvidenceLevel {
  return value === "verified" || value === "confirmed" ? value : "entered";
}

export function mapHistoryRow(row: HistoryDbRow): PackagingHistoryRecord {
  return {
    id: row.id,
    compositionKey: row.composition_key,
    composition: row.composition,
    unitCount: Number(row.unit_count),
    lengthCm: Number(row.length_cm),
    widthCm: Number(row.width_cm),
    heightCm: Number(row.height_cm),
    weightGrams: row.weight_grams != null ? Number(row.weight_grams) : null,
    serviceCode: row.service_code,
    packageSource: row.package_source === "preset" ? "preset" : "custom",
    presetId: row.preset_id,
    evidenceLevel: evidenceLevel(row.evidence_level),
    enteredAt: row.entered_at,
    confirmedAt: row.confirmed_at,
    verifiedAt: row.verified_at,
    supersededAt: row.superseded_at,
    createdAt: row.created_at,
    orderId: row.order_id,
    shipmentId: row.shipment_id,
    shopDomain: row.shop_domain,
    rejectedOrderIds: Array.isArray(row.rejected_order_ids) ? row.rejected_order_ids : [],
  };
}

export async function loadHistoryForKey(
  supabase: SupabaseClient,
  organizationId: string,
  compositionKey: string
): Promise<PackagingHistoryRecord[]> {
  try {
    const { data, error } = await supabase
      .from("packaging_history")
      .select(HISTORY_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("composition_key", compositionKey)
      .is("superseded_at", null)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error || !Array.isArray(data)) return [];
    return (data as HistoryDbRow[]).map(mapHistoryRow);
  } catch {
    return [];
  }
}

/** Composition of an order's remaining shippable lines, from stored Shopify variant ids. */
export async function loadOrderComposition(
  supabase: SupabaseClient,
  organizationId: string,
  orderId: string
): Promise<ShipmentComposition> {
  const { data, error } = await supabase
    .from("order_line_items")
    .select("shopify_variant_id, shopify_product_id, sku, title, quantity, unfulfilled_quantity, requires_shipping")
    .eq("organization_id", organizationId)
    .eq("order_id", orderId);
  if (error || !Array.isArray(data)) return { ok: false, reason: "MISSING_VARIANT_IDS" };
  return compositionFromOrderLines(data);
}

async function orderShopDomain(supabase: SupabaseClient, organizationId: string, orderId: string) {
  const { data } = await supabase
    .from("external_order_references")
    .select("shop_domain")
    .eq("organization_id", organizationId)
    .eq("order_id", orderId)
    .eq("source", "SHOPIFY")
    .limit(1)
    .maybeSingle();
  return (data as { shop_domain?: string | null } | null)?.shop_domain ?? null;
}

export type MerchantBoxInput = {
  organizationId: string;
  userId?: string | null;
  orderId: string;
  shipmentId: string;
  box: CmBox;
  weightGrams?: number | null;
  serviceCode: string;
  packageSource: "preset" | "custom";
  presetId?: string | null;
  /** Merchant ticked "Measured". Only this makes a row eligible for auto-apply. */
  measured?: boolean;
};

/**
 * Remembers a box the merchant chose for an exact composition.
 * Same box as a live row: that row is reused (and verified when measured).
 * Different box: older live rows for the composition are superseded, so the latest choice wins.
 */
export async function recordMerchantBox(
  supabase: SupabaseClient,
  input: MerchantBoxInput
): Promise<{ recorded: boolean; historyId?: string; reason?: string }> {
  try {
    const composition = await loadOrderComposition(supabase, input.organizationId, input.orderId);
    if (!composition.ok) return { recorded: false, reason: composition.reason };

    const live = await loadHistoryForKey(supabase, input.organizationId, composition.key);
    const now = new Date().toISOString();
    const match = live.find((row) => sameBox(row, input.box));

    if (match) {
      const patch: Record<string, unknown> = { shipment_id: input.shipmentId, order_id: input.orderId };
      if (input.measured && match.evidenceLevel !== "verified") {
        patch.evidence_level = "verified";
        patch.verified_at = now;
        patch.verified_by = input.userId || null;
      }
      if (input.packageSource === "preset" && input.presetId) {
        patch.package_source = "preset";
        patch.preset_id = input.presetId;
      }
      await supabase
        .from("packaging_history")
        .update(patch)
        .eq("id", match.id)
        .eq("organization_id", input.organizationId);
      const stale = live.filter((row) => row.id !== match.id).map((row) => row.id);
      if (stale.length) {
        await supabase
          .from("packaging_history")
          .update({ superseded_at: now })
          .eq("organization_id", input.organizationId)
          .in("id", stale)
          .is("superseded_at", null);
      }
      return { recorded: true, historyId: match.id };
    }

    if (live.length) {
      await supabase
        .from("packaging_history")
        .update({ superseded_at: now })
        .eq("organization_id", input.organizationId)
        .eq("composition_key", composition.key)
        .is("superseded_at", null);
    }

    const shopDomain = await orderShopDomain(supabase, input.organizationId, input.orderId).catch(() => null);
    const weight = Number(input.weightGrams);
    const { data, error } = await supabase
      .from("packaging_history")
      .insert({
        organization_id: input.organizationId,
        shop_domain: shopDomain,
        order_id: input.orderId,
        shipment_id: input.shipmentId,
        composition_key: composition.key,
        composition: composition.items,
        unit_count: composition.unitCount,
        length_cm: input.box.lengthCm,
        width_cm: input.box.widthCm,
        height_cm: input.box.heightCm,
        weight_grams: Number.isFinite(weight) && weight >= 1 && weight <= 35000 ? Math.round(weight) : null,
        service_code: input.serviceCode,
        package_source: input.packageSource,
        preset_id: input.packageSource === "preset" ? input.presetId || null : null,
        evidence_level: input.measured ? "verified" : "entered",
        entered_by: input.userId || null,
        entered_at: now,
        ...(input.measured ? { verified_at: now, verified_by: input.userId || null } : {}),
      })
      .select("id")
      .single();
    if (error || !data) return { recorded: false, reason: error?.message ?? "insert failed" };
    return { recorded: true, historyId: (data as { id: string }).id };
  } catch (error) {
    logInfo("autopack.history_record_skipped", {
      organizationId: input.organizationId,
      shipmentId: input.shipmentId,
      message: error instanceof Error ? error.message : "record failed",
    });
    return { recorded: false, reason: "error" };
  }
}

/**
 * After India Post accepts the article: an entered row for this shipment becomes confirmed
 * when the booked box still matches. Confirmed means "booked with", never "measured".
 */
export async function confirmHistoryForBookedShipment(
  supabase: SupabaseClient,
  input: { organizationId: string; shipmentId: string; box?: Partial<CmBox> | null }
) {
  try {
    const { data, error } = await supabase
      .from("packaging_history")
      .select(HISTORY_COLUMNS)
      .eq("organization_id", input.organizationId)
      .eq("shipment_id", input.shipmentId)
      .is("superseded_at", null)
      .is("confirmed_at", null);
    if (error || !Array.isArray(data) || !data.length) return;
    let booked = input.box;
    if (!(Number(booked?.lengthCm) > 0 && Number(booked?.widthCm) > 0 && Number(booked?.heightCm) > 0)) {
      const { data: shipment } = await supabase
        .from("shipments")
        .select("length_cm, width_cm, height_cm")
        .eq("organization_id", input.organizationId)
        .eq("id", input.shipmentId)
        .maybeSingle();
      const row = shipment as { length_cm?: number | string; width_cm?: number | string; height_cm?: number | string } | null;
      booked = { lengthCm: Number(row?.length_cm), widthCm: Number(row?.width_cm), heightCm: Number(row?.height_cm) };
    }
    const now = new Date().toISOString();
    for (const row of (data as HistoryDbRow[]).map(mapHistoryRow)) {
      if (!sameBox(row, booked as CmBox)) continue;
      await supabase
        .from("packaging_history")
        .update({
          confirmed_at: now,
          ...(row.evidenceLevel === "entered" ? { evidence_level: "confirmed" } : {}),
        })
        .eq("id", row.id)
        .eq("organization_id", input.organizationId)
        .is("confirmed_at", null);
    }
  } catch (error) {
    logInfo("autopack.history_confirm_skipped", {
      organizationId: input.organizationId,
      shipmentId: input.shipmentId,
      message: error instanceof Error ? error.message : "confirm failed",
    });
  }
}

export async function listPackagingHistory(
  supabase: SupabaseClient,
  organizationId: string,
  options?: { limit?: number }
): Promise<PackagingHistoryRecord[]> {
  const { data, error } = await supabase
    .from("packaging_history")
    .select(HISTORY_COLUMNS)
    .eq("organization_id", organizationId)
    .is("superseded_at", null)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(options?.limit ?? 50, 1), 200));
  if (error) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not load past boxes.");
  return ((data ?? []) as HistoryDbRow[]).map(mapHistoryRow);
}

export async function verifyPackagingHistory(
  supabase: SupabaseClient,
  ctx: { organizationId: string; userId: string },
  historyId: string
): Promise<PackagingHistoryRecord> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("packaging_history")
    .update({ evidence_level: "verified", verified_at: now, verified_by: ctx.userId || null })
    .eq("id", historyId)
    .eq("organization_id", ctx.organizationId)
    .is("superseded_at", null)
    .select(HISTORY_COLUMNS)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not mark the box as measured.");
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Past box not found.");
  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "autopack.history_verified",
    entity_type: "packaging_history",
    entity_id: historyId,
  });
  return mapHistoryRow(data as HistoryDbRow);
}

export async function retirePackagingHistory(
  supabase: SupabaseClient,
  ctx: { organizationId: string; userId: string },
  historyId: string
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("packaging_history")
    .update({ superseded_at: new Date().toISOString() })
    .eq("id", historyId)
    .eq("organization_id", ctx.organizationId)
    .is("superseded_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not remove the past box.");
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Past box not found.");
  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "autopack.history_retired",
    entity_type: "packaging_history",
    entity_id: historyId,
  });
  return { id: (data as { id: string }).id };
}

/** Merchant rejected this past box for one order. AutoPack will not suggest or apply it there again. */
export async function rejectPackagingHistoryForOrder(
  supabase: SupabaseClient,
  ctx: { organizationId: string; userId: string },
  historyId: string,
  orderId: string
): Promise<{ id: string; orderId: string }> {
  const { data, error } = await supabase
    .from("packaging_history")
    .select("id, rejected_order_ids")
    .eq("id", historyId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not reject the suggestion.");
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Past box not found.");
  const current = Array.isArray((data as { rejected_order_ids?: string[] }).rejected_order_ids)
    ? ((data as { rejected_order_ids: string[] }).rejected_order_ids)
    : [];
  if (!current.includes(orderId)) {
    const { error: updateError } = await supabase
      .from("packaging_history")
      .update({ rejected_order_ids: [...current, orderId] })
      .eq("id", historyId)
      .eq("organization_id", ctx.organizationId);
    if (updateError) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not reject the suggestion.");
  }
  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "autopack.suggestion_rejected",
    entity_type: "order",
    entity_id: orderId,
    after: { packaging_history_id: historyId },
  });
  return { id: historyId, orderId };
}
