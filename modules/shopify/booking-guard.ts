import type { SupabaseClient } from "@supabase/supabase-js";
import { isAuthoritativeIndiaPostBooking } from "@/modules/india-post/booking-idempotency";
import { loadShopifyAllocations, replaceShopifyShipmentAllocations } from "@/modules/shopify/allocations";
import { evaluateShopifyOrderEligibility } from "@/modules/shopify/eligibility";
import { fetchShopifyOrderFulfillmentOrders } from "@/modules/shopify/fulfillment-orders";

export type ShopifyBookingGuardResult = {
  ok: boolean;
  reason?: string;
  allocations?: Awaited<ReturnType<typeof replaceShopifyShipmentAllocations>>;
};

export async function revalidateShopifyBooking(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    shipment: {
      id: string;
      order_id?: string | null;
      barcode?: string | null;
      tracking_number?: string | null;
      booked_at?: string | null;
      status?: string | null;
      orders?: {
        id?: string | null;
        source?: string | null;
        source_order_id?: string | null;
        cancelled_at?: string | null;
        fulfillment_status?: string | null;
      } | null;
    };
  }
): Promise<ShopifyBookingGuardResult> {
  const order = input.shipment.orders;
  if ((order?.source ?? "").toUpperCase() !== "SHOPIFY") {
    return { ok: true };
  }
  if (isAuthoritativeIndiaPostBooking(input.shipment)) {
    return { ok: true, reason: "already_booked" };
  }

  const orderId = String(order?.id || input.shipment.order_id || "");
  let sourceOrderId = String(order?.source_order_id || "").trim();
  if (!sourceOrderId && orderId) {
    const { data: ref } = await supabase
      .from("external_order_references")
      .select("source_order_id")
      .eq("organization_id", input.organizationId)
      .eq("order_id", orderId)
      .eq("source", "SHOPIFY")
      .maybeSingle();
    sourceOrderId = ref?.source_order_id ? String(ref.source_order_id) : "";
  }
  if (!orderId || !sourceOrderId) {
    return { ok: false, reason: "Shopify order id is missing. Booking is blocked." };
  }

  const { loadShopifyConnection, resolveShopifyAdminToken } = await import("@/modules/shopify/orders");
  const connection = await loadShopifyConnection(supabase, input.organizationId);
  const shop = connection?.shop_domain;
  const token = await resolveShopifyAdminToken(connection);
  if (!shop || !token) {
    return { ok: false, reason: "Shopify is not connected. Fulfillment could not be revalidated." };
  }

  let snapshot;
  try {
    snapshot = await fetchShopifyOrderFulfillmentOrders(shop, token, sourceOrderId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopify fulfillment orders could not be loaded.";
    return { ok: false, reason: message };
  }

  const allocations = await loadShopifyAllocations(supabase, {
    organizationId: input.organizationId,
    orderId,
  });
  const eligibility = evaluateShopifyOrderEligibility(
    {
      cancelledAt: snapshot.cancelledAt,
      displayFulfillmentStatus: snapshot.displayFulfillmentStatus,
      line_items: [],
      fulfillmentOrders: snapshot.fulfillmentOrders,
    },
    {
      fulfillmentOrders: snapshot.fulfillmentOrders,
      allocations,
      currentShipmentId: input.shipment.id,
      fulfillmentOrdersFetched: true,
    }
  );

  if (!eligibility.eligibleForBooking || !eligibility.bookableFulfillmentLines.length) {
    return {
      ok: false,
      reason: eligibility.bookingBlockReason || "Shopify fulfillment is not currently permitted.",
    };
  }

  const rows = await replaceShopifyShipmentAllocations(supabase, {
    organizationId: input.organizationId,
    shipmentId: input.shipment.id,
    orderId,
    shopifyOrderId: sourceOrderId,
    lines: eligibility.bookableFulfillmentLines,
  });
  return { ok: true, allocations: rows };
}
