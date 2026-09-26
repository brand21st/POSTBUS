import type { SupabaseClient } from "@supabase/supabase-js";

export async function enqueueTrackingStageSideEffects(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    shipmentId: string;
    orderId: string;
    orderStatus: "IN_TRANSIT" | "DELIVERED";
    body?: string | null;
  }
) {
  const stage = input.orderStatus === "DELIVERED" ? "delivered" : "in_transit";
  try {
    const { enqueueWatiNotify } = await import("@/modules/wati/send");
    await enqueueWatiNotify(supabase, input.organizationId, stage, {
      shipmentId: input.shipmentId,
      orderId: input.orderId,
    });
  } catch {
    // WhatsApp is optional; tracking updates should still persist.
  }
  try {
    const { getAutomationSettings } = await import("@/modules/automation/service");
    const automation = await getAutomationSettings(supabase, input.organizationId);
    if (automation.autoShopifyFulfillment !== false) {
      const { syncShopifyOrderStage } = await import("@/modules/shopify/orders");
      await syncShopifyOrderStage(supabase, {
        organizationId: input.organizationId,
        orderId: input.orderId,
        shipmentId: input.shipmentId,
        stage,
      });
    }
  } catch {
    // Shopify fulfillment events are optional; tracking updates should still persist.
  }
  try {
    const { insertOrderStageNotification } = await import("@/lib/notifications/order-stage");
    await insertOrderStageNotification(supabase, {
      organizationId: input.organizationId,
      orderId: input.orderId,
      event: stage,
      body: input.body ?? null,
    });
  } catch {
    // In-app alerts are optional; tracking updates should still persist.
  }
}
