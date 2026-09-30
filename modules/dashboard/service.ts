import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";

export const PIPELINE = [
  { key: "IMPORTED", label: "Imported" },
  { key: "READY", label: "Ready" },
  { key: "PROCESSING", label: "Booking" },
  { key: "BOOKED", label: "Booked" },
  { key: "SHIPPED", label: "Label / Manifest" },
  { key: "IN_TRANSIT", label: "In transit" },
  { key: "DELIVERED", label: "Delivered" },
] as const;

export type KpiWindowCounts = {
  orders: number;
  ready: number;
  booked: number;
  inTransit: number;
  delivered: number;
  failed: number;
};

export function previousWindow(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T23:59:59.999Z`).getTime();
  const duration = end - start;
  return {
    from: new Date(start - duration).toISOString().slice(0, 10),
    to: new Date(start - 1).toISOString().slice(0, 10),
  };
}

export function kpiMetric(
  current: KpiWindowCounts,
  prior: KpiWindowCounts,
  key: keyof KpiWindowCounts,
  label: string
) {
  const value = current[key];
  const prev = prior[key];
  const comparisonAvailable = prior.orders > 0 || current.orders > 0;
  return {
    key,
    label,
    value,
    previous: comparisonAvailable ? prev : null,
    change: comparisonAvailable && prev > 0 ? ((value - prev) / prev) * 100 : null,
    comparisonAvailable,
  };
}

export function kpisFromWindows(current: KpiWindowCounts, prior: KpiWindowCounts) {
  return {
    orders: kpiMetric(current, prior, "orders", "Orders"),
    readyToShip: kpiMetric(current, prior, "ready", "Ready to ship"),
    ready: kpiMetric(current, prior, "ready", "Ready to ship"),
    booked: kpiMetric(current, prior, "booked", "Booked"),
    inTransit: kpiMetric(current, prior, "inTransit", "In transit"),
    delivered: kpiMetric(current, prior, "delivered", "Delivered"),
    failed: kpiMetric(current, prior, "failed", "Failed"),
  };
}

export function pipelineFromStatusCounts(counts: Record<string, number>) {
  return {
    stages: PIPELINE.map((stage) => ({
      key: stage.key,
      label: stage.label,
      count: counts[stage.key] ?? 0,
    })),
  };
}

function rangeIso(from: string, to: string) {
  return { from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` };
}

function mapKpiRow(row: {
  orders?: number | string | null;
  ready?: number | string | null;
  booked?: number | string | null;
  in_transit?: number | string | null;
  delivered?: number | string | null;
  failed?: number | string | null;
} | null): KpiWindowCounts | null {
  if (!row) return null;
  return {
    orders: Number(row.orders ?? 0),
    ready: Number(row.ready ?? 0),
    booked: Number(row.booked ?? 0),
    inTransit: Number(row.in_transit ?? 0),
    delivered: Number(row.delivered ?? 0),
    failed: Number(row.failed ?? 0),
  };
}

async function countWindowRpc(
  supabase: SupabaseClient,
  organizationId: string,
  from: string,
  to: string
) {
  const range = rangeIso(from, to);
  const { data, error } = await supabase.rpc("dashboard_kpi_window", {
    p_organization_id: organizationId,
    p_from: range.from,
    p_to: range.to,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return mapKpiRow(row as Parameters<typeof mapKpiRow>[0]);
}

export async function getKpis(
  supabase: SupabaseClient,
  ctx: TenantContext,
  from: string,
  to: string
) {
  const previous = previousWindow(from, to);
  const [current, prior] = await Promise.all([
    countWindow(supabase, ctx.organizationId, from, to),
    countWindow(supabase, ctx.organizationId, previous.from, previous.to),
  ]);
  return kpisFromWindows(current, prior);
}

export async function getPipeline(
  supabase: SupabaseClient,
  ctx: TenantContext,
  from: string,
  to: string
) {
  const range = rangeIso(from, to);
  const { data, error } = await supabase.rpc("dashboard_pipeline_counts", {
    p_organization_id: ctx.organizationId,
    p_from: range.from,
    p_to: range.to,
  });
  if (!error) {
    const counts: Record<string, number> = {};
    for (const row of (data ?? []) as Array<{ status?: string; total?: number | string }>) {
      if (row.status) counts[row.status] = Number(row.total ?? 0);
    }
    return pipelineFromStatusCounts(counts);
  }

  const stages = await Promise.all(
    PIPELINE.map(async (stage) => {
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", ctx.organizationId)
        .eq("status", stage.key)
        .gte("created_at", range.from)
        .lte("created_at", range.to);
      return { key: stage.key, label: stage.label, count: count ?? 0 };
    })
  );
  return { stages };
}

async function countWindow(
  supabase: SupabaseClient,
  organizationId: string,
  from: string,
  to: string
): Promise<KpiWindowCounts> {
  const fromRpc = await countWindowRpc(supabase, organizationId, from, to);
  if (fromRpc) return fromRpc;

  const range = rangeIso(from, to);
  const [orders, ready, booked, inTransit, delivered, failed] = await Promise.all([
    countOrders(supabase, organizationId, range),
    countOrders(supabase, organizationId, range, ["READY"]),
    countShipments(supabase, organizationId, range, ["BOOKED", "LABEL_READY", "MANIFEST_READY"]),
    countShipments(supabase, organizationId, range, ["IN_TRANSIT", "OUT_FOR_DELIVERY"]),
    countShipments(supabase, organizationId, range, ["DELIVERED"]),
    countShipments(supabase, organizationId, range, ["FAILED"]),
  ]);
  return { orders, ready, booked, inTransit, delivered, failed };
}

async function countOrders(
  supabase: SupabaseClient,
  organizationId: string,
  range: { from: string; to: string },
  statuses?: string[]
) {
  let q = supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("created_at", range.from)
    .lte("created_at", range.to);
  if (statuses) q = q.in("status", statuses);
  const { count } = await q;
  return count ?? 0;
}

async function countShipments(
  supabase: SupabaseClient,
  organizationId: string,
  range: { from: string; to: string },
  statuses: string[]
) {
  const { count } = await supabase
    .from("shipments")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("status", statuses)
    .gte("created_at", range.from)
    .lte("created_at", range.to);
  return count ?? 0;
}
