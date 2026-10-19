import type { SupabaseClient } from "@supabase/supabase-js";
import { orderCogsPaise } from "@/modules/ai-accountant/ledger/posting-rules";
import { paiseFromNumeric } from "@/modules/ai-accountant/money";

/**
 * Contribution for one order: revenue ex-tax − COGS (product costs by SKU) −
 * India Post postage − COD commission. INCOMPLETE when any SKU lacks a cost.
 */
export async function orderContribution(
  supabase: SupabaseClient,
  organizationId: string,
  lookup: { orderId?: string; orderNumber?: string }
) {
  let query = supabase
    .from("orders")
    .select("id, order_number, subtotal, tax_amount, total_amount, shipping_amount")
    .eq("organization_id", organizationId)
    .limit(1);
  if (lookup.orderId) query = query.eq("id", lookup.orderId);
  else if (lookup.orderNumber) query = query.in("order_number", [lookup.orderNumber, `#${lookup.orderNumber.replace(/^#/, "")}`]);
  else return { completeness: "INCOMPLETE" as const, reason: "order_not_found" };
  const { data: order } = await query.maybeSingle();
  if (!order) return { completeness: "INCOMPLETE" as const, reason: "order_not_found" };

  const [{ data: lines }, { data: shipments }, { data: products }] = await Promise.all([
    supabase.from("order_line_items").select("sku, quantity").eq("organization_id", organizationId).eq("order_id", order.id),
    supabase.from("shipments").select("id, tariff_amount").eq("organization_id", organizationId).eq("order_id", order.id),
    supabase.from("products").select("id, sku").eq("organization_id", organizationId).limit(10000),
  ]);
  const skuByProduct = new Map((products ?? []).map((p) => [p.id as string, String(p.sku).trim().toLowerCase()]));
  const { data: costs } = skuByProduct.size
    ? await supabase
        .from("product_costs")
        .select("product_id, unit_cost, effective_from")
        .eq("organization_id", organizationId)
        .in("product_id", [...skuByProduct.keys()].slice(0, 1000))
        .order("effective_from", { ascending: true })
    : { data: [] };
  const unitCostBySku = new Map<string, number>();
  for (const row of costs ?? []) {
    const sku = skuByProduct.get(row.product_id);
    if (sku) unitCostBySku.set(sku, paiseFromNumeric(row.unit_cost));
  }
  const cogsPaise = orderCogsPaise(
    (lines ?? []).map((line) => ({ sku: line.sku, quantity: Number(line.quantity ?? 1) })),
    unitCostBySku
  );

  const shipmentIds = (shipments ?? []).map((s) => s.id as string);
  let commissionPaise = 0;
  if (shipmentIds.length) {
    const { data: recon } = await supabase
      .from("cod_reconciliations")
      .select("cod_report_rows(commission_amount)")
      .eq("organization_id", organizationId)
      .eq("status", "RECONCILED")
      .in("shipment_id", shipmentIds);
    for (const row of recon ?? []) {
      const reportRow = (Array.isArray(row.cod_report_rows) ? row.cod_report_rows[0] : row.cod_report_rows) as { commission_amount?: string } | null;
      commissionPaise += paiseFromNumeric(reportRow?.commission_amount);
    }
  }
  const shippingExpensePaise = (shipments ?? []).reduce((sum, s) => sum + paiseFromNumeric(s.tariff_amount), 0);
  const revenueExTaxPaise = paiseFromNumeric(order.total_amount) - paiseFromNumeric(order.tax_amount);
  const base = { orderNumber: order.order_number as string, revenueExTaxPaise, shippingExpensePaise, commissionPaise };
  if (cogsPaise === null) {
    return { completeness: "INCOMPLETE" as const, reason: "missing_product_cost", ...base };
  }
  return {
    completeness: "ACTUAL" as const,
    ...base,
    cogsPaise,
    contributionPaise: revenueExTaxPaise - cogsPaise - shippingExpensePaise - commissionPaise,
  };
}
