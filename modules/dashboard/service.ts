import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";

const PIPELINE = [
  { key: "IMPORTED", label: "Imported" },
  { key: "READY", label: "Ready" },
  { key: "PROCESSING", label: "Booking" },
  { key: "BOOKED", label: "Booked" },
  { key: "SHIPPED", label: "Label / Manifest" },
  { key: "DELIVERED", label: "Delivered" },
];

export async function getKpis(
  supabase: SupabaseClient,
  ctx: TenantContext,
  from: string,
  to: string
) {
  const current = await countWindow(supabase, ctx.organizationId, from, to);
  const previous = previousWindow(from, to);
  const prior = await countWindow(supabase, ctx.organizationId, previous.from, previous.to);

  function metric(key: keyof typeof current, label: string) {
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

  return {
    orders: metric("orders", "Orders"),
    readyToShip: metric("ready", "Ready to ship"),
    ready: metric("ready", "Ready to ship"),
    booked: metric("booked", "Booked"),
    inTransit: metric("inTransit", "In transit"),
    delivered: metric("delivered", "Delivered"),
    failed: metric("failed", "Failed"),
  };
}

export async function getPipeline(
  supabase: SupabaseClient,
  ctx: TenantContext,
  from: string,
  to: string
) {
  const stages = [];
  for (const stage of PIPELINE) {
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.organizationId)
      .eq("status", stage.key)
      .gte("created_at", `${from}T00:00:00.000Z`)
      .lte("created_at", `${to}T23:59:59.999Z`);
    stages.push({ key: stage.key, label: stage.label, count: count ?? 0 });
  }
  return { stages };
}

async function countWindow(supabase: SupabaseClient, organizationId: string, from: string, to: string) {
  const range = { from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` };
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

function previousWindow(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T23:59:59.999Z`).getTime();
  const duration = end - start;
  return {
    from: new Date(start - duration).toISOString().slice(0, 10),
    to: new Date(start - 1).toISOString().slice(0, 10),
  };
}
