import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";
import { isMerchantWebhooksOpenForOrg } from "@/modules/merchant-api/flags";
import {
  shouldEmitBookingRequested,
  shouldEmitOrderUpdated,
  trackingStageEvents,
  type MerchantWebhookEvent,
} from "@/modules/webhooks/catalog";
import { recordWebhookEvent, trackingUrlForAwb } from "@/modules/webhooks/outbox";

async function publish(
  supabase: SupabaseClient,
  input: Parameters<typeof recordWebhookEvent>[1]
) {
  try {
    await recordWebhookEvent(supabase, input);
  } catch (error) {
    logError("webhook.publish_failed", {
      message: error instanceof Error ? error.message : "publish failed",
      type: input.type,
    });
  }
}

export async function publishOrderCreated(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    orderId: string;
    orderNumber?: string | null;
    externalOrderId?: string | null;
    status?: string | null;
  }
) {
  await publish(supabase, {
    organizationId: input.organizationId,
    type: "order.created",
    resourceType: "order",
    resourceId: input.orderId,
    dedupeKey: `order.created:${input.organizationId}:${input.orderId}`,
    data: {
      order_id: input.orderId,
      order_number: input.orderNumber,
      external_order_id: input.externalOrderId,
      status: input.status ?? "READY",
    },
  });
}

export async function publishOrderUpdated(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    orderId: string;
    orderNumber?: string | null;
    externalOrderId?: string | null;
    previousStatus: string;
    status: string;
  }
) {
  if (!shouldEmitOrderUpdated(input.previousStatus, input.status)) return;
  await publish(supabase, {
    organizationId: input.organizationId,
    type: "order.updated",
    resourceType: "order",
    resourceId: input.orderId,
    dedupeKey: `order.updated:${input.organizationId}:${input.orderId}:${input.previousStatus}->${input.status}`,
    data: {
      order_id: input.orderId,
      order_number: input.orderNumber,
      external_order_id: input.externalOrderId,
      status: input.status,
      previous_status: input.previousStatus,
    },
  });
}

export async function publishBookingRequested(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    shipmentId: string;
    orderId?: string | null;
    previousStatus?: string | null;
    orderNumber?: string | null;
  }
) {
  if (!shouldEmitBookingRequested(input.previousStatus)) return;
  await publish(supabase, {
    organizationId: input.organizationId,
    type: "shipment.booking_requested",
    resourceType: "shipment",
    resourceId: input.shipmentId,
    dedupeKey: `shipment.booking_requested:${input.organizationId}:${input.shipmentId}:${input.previousStatus ?? "NEW"}->QUEUED`,
    data: {
      shipment_id: input.shipmentId,
      order_id: input.orderId,
      order_number: input.orderNumber,
      status: "QUEUED",
      previous_status: input.previousStatus,
    },
  });
}

export async function publishShipmentBooked(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    shipmentId: string;
    orderId?: string | null;
    awb?: string | null;
  }
) {
  await publish(supabase, {
    organizationId: input.organizationId,
    type: "shipment.booked",
    resourceType: "shipment",
    resourceId: input.shipmentId,
    dedupeKey: `shipment.booked:${input.organizationId}:${input.shipmentId}`,
    data: {
      shipment_id: input.shipmentId,
      order_id: input.orderId,
      awb: input.awb,
      status: "BOOKED",
      previous_status: "BOOKING",
      tracking_url: trackingUrlForAwb(input.awb),
    },
  });
}

export async function publishBookingFailed(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    shipmentId: string;
    orderId?: string | null;
    errorCode?: string | null;
  }
) {
  await publish(supabase, {
    organizationId: input.organizationId,
    type: "shipment.booking_failed",
    resourceType: "shipment",
    resourceId: input.shipmentId,
    dedupeKey: `shipment.booking_failed:${input.organizationId}:${input.shipmentId}:${input.errorCode ?? "FAILED"}`,
    data: {
      shipment_id: input.shipmentId,
      order_id: input.orderId,
      status: "FAILED",
      error_code: input.errorCode ?? "VALIDATION_ERROR",
    },
  });
}

export async function publishTrackingResult(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    shipmentId: string;
    orderId?: string | null;
    inserted: boolean;
    previousStatus: string;
    nextStatus: string;
    previousOperational: string | null;
    nextOperational: string | null;
    eventCode: string;
    occurredAt: string;
    awb?: string | null;
    orderNumber?: string | null;
    previousOrderStatus?: string | null;
    nextOrderStatus?: string | null;
  }
) {
  if (!isMerchantWebhooksOpenForOrg(input.organizationId)) return;
  const stages = trackingStageEvents({
    inserted: input.inserted,
    previousStatus: input.previousStatus,
    nextStatus: input.nextStatus,
    previousOperational: input.previousOperational,
    nextOperational: input.nextOperational,
  });
  for (const stage of stages) {
    const dedupe =
      stage.type === "tracking.updated"
        ? `tracking.updated:${input.organizationId}:${input.shipmentId}:${input.eventCode}:${input.occurredAt}`
        : `${stage.type}:${input.organizationId}:${input.shipmentId}:${input.previousStatus}->${stage.status}`;
    await publish(supabase, {
      organizationId: input.organizationId,
      type: stage.type as MerchantWebhookEvent,
      resourceType: "shipment",
      resourceId: input.shipmentId,
      dedupeKey: dedupe,
      data: {
        shipment_id: input.shipmentId,
        order_id: input.orderId,
        order_number: input.orderNumber,
        awb: input.awb,
        status: stage.status,
        previous_status: stage.type === "tracking.updated" ? input.previousStatus : input.previousStatus,
        tracking_url: trackingUrlForAwb(input.awb),
      },
    });
  }
  if (input.orderId && input.nextOrderStatus && shouldEmitOrderUpdated(input.previousOrderStatus, input.nextOrderStatus)) {
    await publishOrderUpdated(supabase, {
      organizationId: input.organizationId,
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      previousStatus: input.previousOrderStatus ?? "",
      status: input.nextOrderStatus,
    });
  }
}
