import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import type { ShipmentComposition } from "@/modules/autopack/composition";
import {
  decidePackage,
  historyDecisionChoice,
  type DecisionShipment,
  type PackageDecision,
} from "@/modules/autopack/decide";
import { loadHistoryForKey, loadOrderComposition } from "@/modules/autopack/history";
import type { PackageOption, ResolvedShipmentDimensions } from "@/modules/shopify/dimensions";
import { DEFAULT_INDIA_POST_SERVICE } from "@/types/domain";

/** Merchant opt-in. Missing column or row reads as off. */
export async function isAutoPackageSelectionEnabled(supabase: SupabaseClient, organizationId: string) {
  try {
    const { data, error } = await supabase
      .from("automation_settings")
      .select("auto_package_selection")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) return false;
    return (data as { auto_package_selection?: boolean } | null)?.auto_package_selection === true;
  } catch {
    return false;
  }
}

/** Saved pack sizes shared by the workspace. */
export async function loadWorkspacePackages(supabase: SupabaseClient, organizationId: string): Promise<PackageOption[]> {
  try {
    const { data, error } = await supabase
      .from("user_shipment_presets")
      .select("id, name, length_cm, width_cm, height_cm")
      .eq("organization_id", organizationId);
    if (error || !Array.isArray(data)) return [];
    return data.flatMap((row) => {
      const record = row as { id?: string; name?: string; length_cm?: number; width_cm?: number; height_cm?: number };
      const lengthCm = Number(record.length_cm);
      const widthCm = Number(record.width_cm);
      const heightCm = Number(record.height_cm);
      if (!(lengthCm > 0 && widthCm > 0 && heightCm > 0) || !record.id) return [];
      return [{ id: String(record.id), name: String(record.name ?? "Package"), lengthCm, widthCm, heightCm }];
    });
  } catch {
    return [];
  }
}

export type AutoPackEvaluation = {
  decision: PackageDecision;
  /** Set only when the merchant opted in and the decision rests on verified history. */
  autoChoice: ResolvedShipmentDimensions | null;
  autoSelectionEnabled: boolean;
};

export async function evaluateAutoPack(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    orderId?: string | null;
    composition: ShipmentComposition;
    serviceCode?: string | null;
    weightGrams?: number | null;
    shipment?: DecisionShipment | null;
    presets: PackageOption[];
    fallback?: ResolvedShipmentDimensions | null;
  }
): Promise<AutoPackEvaluation> {
  const history = input.composition.ok
    ? await loadHistoryForKey(supabase, input.organizationId, input.composition.key)
    : [];
  const rejectedEvidenceIds = input.orderId
    ? history.filter((row) => row.rejectedOrderIds.includes(input.orderId as string)).map((row) => row.id)
    : [];
  const decision = decidePackage({
    shipment: input.shipment ?? null,
    composition: input.composition,
    history,
    presets: input.presets,
    serviceCode: input.serviceCode || DEFAULT_INDIA_POST_SERVICE,
    weightGrams: input.weightGrams ?? null,
    fallback: input.fallback ?? null,
    rejectedEvidenceIds,
  });
  const autoSelectionEnabled = await isAutoPackageSelectionEnabled(supabase, input.organizationId);
  const eligible =
    autoSelectionEnabled &&
    (decision.kind === "SAVED_PACKAGE" || decision.kind === "CUSTOM_DIMENSIONS") &&
    decision.autoApplicable &&
    decision.evidence.type === "history";
  return { decision, autoChoice: eligible ? historyDecisionChoice(decision) : null, autoSelectionEnabled };
}

/** What AutoPack would do for an order right now. Read-only. */
export async function getOrderAutoPackRecommendation(supabase: SupabaseClient, ctx: TenantContext, orderId: string) {
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, india_post_service, shipments(id, status, booked_at, barcode, service_code, weight_grams, metadata, created_at)")
    .eq("organization_id", ctx.organizationId)
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!order) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found.");

  const shipments =
    ((order as { shipments?: Array<Record<string, unknown>> }).shipments ?? []).filter(
      (row) => String(row.status ?? "").toUpperCase() !== "CANCELLED"
    );
  const shipment = shipments[0] ?? null;
  const [composition, presets] = await Promise.all([
    loadOrderComposition(supabase, ctx.organizationId, orderId),
    loadWorkspacePackages(supabase, ctx.organizationId),
  ]);
  const evaluation = await evaluateAutoPack(supabase, {
    organizationId: ctx.organizationId,
    orderId,
    composition,
    serviceCode:
      (shipment?.service_code as string | undefined) ??
      ((order as { india_post_service?: string | null }).india_post_service ?? null),
    weightGrams: shipment?.weight_grams != null ? Number(shipment.weight_grams) : null,
    shipment: shipment
      ? {
          status: shipment.status as string,
          bookedAt: (shipment.booked_at as string | null) ?? null,
          barcode: (shipment.barcode as string | null) ?? null,
          metadata: shipment.metadata,
        }
      : null,
    presets,
  });
  return {
    orderId,
    shipmentId: (shipment?.id as string | undefined) ?? null,
    decision: evaluation.decision,
    autoSelectionEnabled: evaluation.autoSelectionEnabled,
    composition: composition.ok ? { items: composition.items, unitCount: composition.unitCount } : null,
  };
}
