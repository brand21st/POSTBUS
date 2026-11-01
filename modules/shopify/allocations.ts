import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShopifyBookableFulfillmentLine, ShopifyEligibilityAllocation } from "@/modules/shopify/eligibility";

export type ShopifyShipmentAllocationRow = {
  organization_id: string;
  shipment_id: string;
  order_id: string;
  shopify_order_id: string;
  shopify_fulfillment_order_id: string;
  shopify_fulfillment_order_line_item_id: string;
  shopify_order_line_item_id: string | null;
  quantity: number;
  status: string;
  article_id: string | null;
};

export async function loadShopifyAllocations(
  supabase: SupabaseClient,
  input: { organizationId: string; orderId?: string; shipmentId?: string }
): Promise<ShopifyEligibilityAllocation[]> {
  let query = supabase
    .from("shopify_shipment_allocations")
    .select(
      "shipment_id, shopify_fulfillment_order_line_item_id, quantity, status"
    )
    .eq("organization_id", input.organizationId)
    .in("status", ["RESERVED", "BOOKED"]);
  if (input.orderId) query = query.eq("order_id", input.orderId);
  if (input.shipmentId) query = query.eq("shipment_id", input.shipmentId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    fulfillmentOrderLineItemId: String(row.shopify_fulfillment_order_line_item_id),
    quantity: Number(row.quantity) || 0,
    shipmentId: String(row.shipment_id),
    status: String(row.status),
  }));
}

export async function replaceShopifyShipmentAllocations(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    shipmentId: string;
    orderId: string;
    shopifyOrderId: string;
    lines: ShopifyBookableFulfillmentLine[];
  }
) {
  const { error: deleteError } = await supabase
    .from("shopify_shipment_allocations")
    .delete()
    .eq("organization_id", input.organizationId)
    .eq("shipment_id", input.shipmentId)
    .eq("status", "RESERVED");
  if (deleteError) throw new Error(deleteError.message);

  if (!input.lines.length) return [];

  const rows: ShopifyShipmentAllocationRow[] = input.lines.map((line) => ({
    organization_id: input.organizationId,
    shipment_id: input.shipmentId,
    order_id: input.orderId,
    shopify_order_id: String(input.shopifyOrderId),
    shopify_fulfillment_order_id: line.fulfillmentOrderId,
    shopify_fulfillment_order_line_item_id: line.fulfillmentOrderLineItemId,
    shopify_order_line_item_id: line.orderLineItemId,
    quantity: line.remainingQuantity,
    status: "RESERVED",
    article_id: null,
  }));
  const { error } = await supabase.from("shopify_shipment_allocations").insert(rows);
  if (error) throw new Error(error.message);
  return rows;
}

export async function markShopifyAllocationsBooked(
  supabase: SupabaseClient,
  input: { organizationId: string; shipmentId: string; articleId: string }
) {
  await supabase
    .from("shopify_shipment_allocations")
    .update({ status: "BOOKED", article_id: input.articleId })
    .eq("organization_id", input.organizationId)
    .eq("shipment_id", input.shipmentId)
    .in("status", ["RESERVED", "BOOKED"]);
}

export async function loadShipmentFulfillmentAllocations(
  supabase: SupabaseClient,
  input: { organizationId: string; shipmentId: string }
) {
  const { data, error } = await supabase
    .from("shopify_shipment_allocations")
    .select(
      "shopify_fulfillment_order_id, shopify_fulfillment_order_line_item_id, quantity, status, article_id"
    )
    .eq("organization_id", input.organizationId)
    .eq("shipment_id", input.shipmentId)
    .in("status", ["RESERVED", "BOOKED"]);
  if (error) throw new Error(error.message);
  return data ?? [];
}
