import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrackingNotifyNotice } from "@/modules/india-post/apply-tracking";
import type { TrackingWhatsAppEvent } from "@/modules/india-post/event-mapper";
import type { WatiNotifyEvent } from "@/modules/wati/notify";

export async function enqueueTrackingStageSideEffects(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    shipmentId: string;
    orderId?: string | null;
    orderStatus?: "IN_TRANSIT" | "DELIVERED" | null;
    events?: TrackingWhatsAppEvent[];
    notices?: TrackingNotifyNotice[];
    body?: string | null;
  }
) {
  const events: WatiNotifyEvent[] = [...(input.events ?? [])];
  if (!events.length && input.orderStatus) {
    events.push(input.orderStatus === "DELIVERED" ? "delivered" : "in_transit");
  }
  const ids = {
    shipmentId: input.shipmentId,
    orderId: input.orderId ?? null,
  };

  const notices: Array<{ event: WatiNotifyEvent; eventCode: string; occurredAt: string }> = input.notices?.length
    ? input.notices
    : events.map((event) => ({ event, eventCode: "", occurredAt: "" }));

  for (const notice of notices) {
    const scanIds = {
      ...ids,
      ...(notice.eventCode && notice.occurredAt
        ? { eventCode: notice.eventCode, occurredAt: notice.occurredAt }
        : {}),
    };
    try {
      const { enqueueWatiNotify } = await import("@/modules/wati/send");
      await enqueueWatiNotify(supabase, input.organizationId, notice.event, scanIds);
    } catch {
      // WhatsApp is optional; tracking updates should still persist.
    }
    try {
      const { enqueueVachatNotify } = await import("@/modules/vachat/send");
      await enqueueVachatNotify(supabase, input.organizationId, notice.event, scanIds);
    } catch {
      // Vachat is optional; tracking updates should still persist.
    }
  }

  const shopifyStage =
    events.includes("delivered") || input.orderStatus === "DELIVERED"
      ? "delivered"
      : input.orderStatus === "IN_TRANSIT"
        ? "in_transit"
        : null;
  if (shopifyStage && input.orderId) {
    try {
      const { getAutomationSettings } = await import("@/modules/automation/service");
      const automation = await getAutomationSettings(supabase, input.organizationId);
      if (automation.autoShopifyFulfillment !== false) {
        const { syncShopifyOrderStage } = await import("@/modules/shopify/orders");
        await syncShopifyOrderStage(supabase, {
          organizationId: input.organizationId,
          orderId: input.orderId,
          shipmentId: input.shipmentId,
          stage: shopifyStage,
        });
      }
    } catch {
      // Shopify fulfillment events are optional; tracking updates should still persist.
    }
  }

  const noticeEvent = events.includes("delivered")
    ? "delivered"
    : events.includes("in_transit")
      ? "in_transit"
      : null;
  if (noticeEvent && input.orderId) {
    try {
      const { insertOrderStageNotification } = await import("@/lib/notifications/order-stage");
      await insertOrderStageNotification(supabase, {
        organizationId: input.organizationId,
        orderId: input.orderId,
        event: noticeEvent,
        body: input.body ?? null,
      });
    } catch {
      // In-app alerts are optional; tracking updates should still persist.
    }
  }

  try {
    const { scheduleMerchantKnowledgeSync } = await import("@/modules/vachat/knowledge");
    scheduleMerchantKnowledgeSync(supabase, input.organizationId);
  } catch {
    // VaChat knowledge is optional; tracking updates should still persist.
  }
  if (events.includes("shipment_delayed")) {
    try {
      await supabase.from("notifications").insert({
        organization_id: input.organizationId,
        type: "shipment.delayed",
        title: "Shipment delayed",
        body: (input.body ?? "India Post reported a delay").slice(0, 240),
        entity_type: "shipment",
        entity_id: input.shipmentId,
      });
    } catch {
      // In-app alerts are optional; tracking updates should still persist.
    }
  }
}
