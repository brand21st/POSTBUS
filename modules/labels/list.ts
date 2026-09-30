import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { filterGroupedLabels, groupLabelsByShipment } from "@/modules/labels/group";
import { mapLabelRow } from "@/modules/labels/map";

const LABEL_LIST_SELECT =
  "id, status, created_at, kind, shipment_id, file_url, shipments(barcode, tracking_number, orders(order_number)), print_jobs!print_jobs_label_id_fkey(id, status, error_message, created_at)";

export type LabelKindFilter = "ALL" | "INDIA_POST" | "MERCHANT" | "COMPLETE" | "INCOMPLETE";

export function normalizeLabelKindFilter(kind?: string | null): LabelKindFilter {
  const value = String(kind || "ALL").toUpperCase();
  if (value === "INDIA_POST" || value === "MERCHANT" || value === "COMPLETE" || value === "INCOMPLETE") {
    return value;
  }
  return "ALL";
}

export function matchesLabelKindFilter(hasIndia: boolean, hasMerchant: boolean, kind: LabelKindFilter) {
  if (kind === "INDIA_POST") return hasIndia;
  if (kind === "MERCHANT") return hasMerchant;
  if (kind === "COMPLETE") return hasIndia && hasMerchant;
  if (kind === "INCOMPLETE") return !hasIndia || !hasMerchant;
  return true;
}

type LabelGroupRow = {
  shipment_id: string;
  latest_at: string;
  total_count: number | string;
};

export async function listGroupedLabels(
  supabase: SupabaseClient,
  ctx: TenantContext,
  query: { page: number; pageSize: number; kind?: string | null }
) {
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.max(1, Math.min(query.pageSize || 20, 100));
  const kind = normalizeLabelKindFilter(query.kind);
  const offset = (page - 1) * pageSize;

  const { data, error } = await supabase.rpc("label_shipment_groups", {
    p_organization_id: ctx.organizationId,
    p_kind: kind,
    p_limit: pageSize,
    p_offset: offset,
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

  const groups = (data ?? []) as LabelGroupRow[];
  let total = Number(groups[0]?.total_count ?? 0);
  if (!groups.length && offset > 0) {
    const probe = await supabase.rpc("label_shipment_groups", {
      p_organization_id: ctx.organizationId,
      p_kind: kind,
      p_limit: 1,
      p_offset: 0,
    });
    if (probe.error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, probe.error.message);
    total = Number((probe.data as LabelGroupRow[] | null)?.[0]?.total_count ?? 0);
  }
  const shipmentIds = groups.map((row) => row.shipment_id).filter(Boolean);
  if (!shipmentIds.length) {
    return { items: [], page, pageSize, total };
  }

  const { data: rows, error: labelsError } = await supabase
    .from("labels")
    .select(LABEL_LIST_SELECT)
    .eq("organization_id", ctx.organizationId)
    .in("shipment_id", shipmentIds)
    .in("kind", ["INDIA_POST", "MERCHANT"]);
  if (labelsError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, labelsError.message);

  const grouped = groupLabelsByShipment((rows ?? []).map((row) => mapLabelRow(row as Record<string, unknown>)));
  const filtered = filterGroupedLabels(grouped, kind);
  const byShipment = new Map(filtered.map((row) => [String(row.shipmentId || row.shipment_id), row]));
  const items = shipmentIds.map((id) => byShipment.get(id)).filter(Boolean);

  return {
    items,
    page,
    pageSize,
    total,
  };
}
