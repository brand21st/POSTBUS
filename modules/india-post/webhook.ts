import { createHash } from "crypto";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError, logInfo } from "@/lib/logger";
import { createBackgroundJob } from "@/modules/jobs/service";
import { emitWebhook } from "@/modules/webhooks/outgoing";
import {
  canAdvanceShipmentStatus,
  mapIndiaPostEventToShipmentUpdate,
} from "@/modules/india-post/event-mapper";
import {
  maskTrackingNumber,
  parseIndiaPostWebhook,
  safeWebhookHeaders,
  type IndiaPostWebhookChannel,
  type ParsedIndiaPostWebhook,
} from "@/modules/india-post/webhook-parser";
import type { createAdminClient } from "@/lib/supabase/admin";

export const INDIA_POST_WEBHOOK_MAX_BYTES = 256 * 1024;

export type IndiaPostConnectionRow = {
  id: string;
  organization_id: string;
  status: string | null;
  environment: string | null;
};

export type InboxRow = {
  id: string;
  organization_id: string;
  connection_id: string;
  channel: IndiaPostWebhookChannel;
  tracking_number: string | null;
  event_code: string | null;
  event_timestamp: string | null;
  payload_hash: string;
  raw_payload: Record<string, unknown>;
  process_status: string;
};

function payloadHash(rawBody: string) {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function indiaPostWebhookIdempotencyKey(parsed: ParsedIndiaPostWebhook, rawBody: string) {
  if (parsed.barcode && parsed.eventCode && parsed.eventTimestamp) {
    return {
      kind: "event" as const,
      key: `${parsed.barcode}:${parsed.eventCode}:${parsed.eventTimestamp}`,
    };
  }
  return { kind: "hash" as const, key: payloadHash(rawBody) };
}

export async function acceptIndiaPostWebhook(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    connectionId: string;
    channel: IndiaPostWebhookChannel;
    rawBody: string;
    contentType: string | null;
    headers: Headers;
  }
) {
  if (Buffer.byteLength(input.rawBody, "utf8") > INDIA_POST_WEBHOOK_MAX_BYTES) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Payload too large.");
  }

  const parsed = parseIndiaPostWebhook(input.rawBody, input.contentType, input.channel);
  const hash = payloadHash(input.rawBody);
  const storedPayload = {
    ...parsed.rawPayload,
    _meta: {
      channel: input.channel,
      headers: safeWebhookHeaders(input.headers),
      parseError: parsed.parseError,
    },
  };

  const persist = await supabase.rpc("accept_india_post_webhook", {
    p_connection_id: input.connectionId,
    p_channel: input.channel,
    p_raw_payload: storedPayload,
    p_payload_hash: hash,
    p_tracking_number: parsed.barcode,
    p_event_code: parsed.eventCode,
    p_event_timestamp: parsed.eventTimestamp,
  });

  if (persist.error) {
    if (persist.error.code === "P0002" || persist.error.message?.includes("not_found")) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
    }
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Could not persist webhook event.");
  }

  const result = (persist.data ?? {}) as {
    accepted?: boolean;
    duplicate?: boolean;
    inbox_event_id?: string | null;
    organization_id?: string | null;
  };
  const inboxEventId = result.inbox_event_id ?? null;

  if (result.duplicate) {
    logInfo("india_post.webhook.duplicate", {
      provider: "INDIA_POST",
      connectionId: input.connectionId,
      organizationId: result.organization_id,
      channel: input.channel,
      inboxEventId,
      trackingNumber: maskTrackingNumber(parsed.barcode),
    });
    return { accepted: true, duplicate: true, inboxEventId };
  }

  if (inboxEventId && result.organization_id) {
    try {
      await createBackgroundJob(supabase, {
        organizationId: result.organization_id,
        jobType: "india-post-events",
        entityType: "provider_webhook_inbox",
        entityId: inboxEventId,
      });
    } catch (error) {
      logError("india_post.webhook.enqueue_failed", {
        provider: "INDIA_POST",
        connectionId: input.connectionId,
        organizationId: result.organization_id,
        inboxEventId,
        message: error instanceof Error ? error.message : "enqueue failed",
      });
    }
  }

  logInfo("india_post.webhook.accepted", {
    provider: "INDIA_POST",
    connectionId: input.connectionId,
    channel: input.channel,
    eventCode: parsed.eventCode,
    trackingNumber: maskTrackingNumber(parsed.barcode),
    inboxEventId,
    parseError: parsed.parseError,
  });

  return { accepted: true, duplicate: false, inboxEventId };
}

export async function processIndiaPostInboxEvent(
  supabase: ReturnType<typeof createAdminClient>,
  inboxEventId: string,
  organizationId: string
) {
  const { data: inbox } = await supabase
    .from("provider_webhook_inbox")
    .select("*")
    .eq("id", inboxEventId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!inbox) {
    throw Object.assign(new Error("Webhook inbox event was not found."), {
      code: "VALIDATION_ERROR",
    });
  }

  if (inbox.process_status === "PROCESSED") {
    return { processed: false, reason: "already-processed" };
  }

  const raw = (inbox.raw_payload ?? {}) as Record<string, unknown>;
  const parsed = parseIndiaPostWebhook(
    JSON.stringify(
      Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "_meta"))
    ),
    "application/json",
    inbox.channel as IndiaPostWebhookChannel
  );

  if (!parsed.barcode || !/^[A-Za-z0-9]{5,50}$/.test(parsed.barcode)) {
    await supabase
      .from("provider_webhook_inbox")
      .update({
        process_status: "FAILED",
        process_error: parsed.parseError || "Missing article_number.",
        processed_at: new Date().toISOString(),
      })
      .eq("id", inbox.id)
      .eq("organization_id", organizationId);
    return { processed: false, reason: "missing-barcode" };
  }

  const { data: byBarcode } = await supabase
    .from("shipments")
    .select("id, organization_id, status, barcode, tracking_number, order_id")
    .eq("organization_id", organizationId)
    .eq("barcode", parsed.barcode)
    .maybeSingle();
  const { data: byTracking } = byBarcode
    ? { data: byBarcode }
    : await supabase
        .from("shipments")
        .select("id, organization_id, status, barcode, tracking_number, order_id")
        .eq("organization_id", organizationId)
        .eq("tracking_number", parsed.barcode)
        .maybeSingle();
  const shipment = byBarcode ?? byTracking;

  if (!shipment || shipment.organization_id !== organizationId) {
    await supabase
      .from("provider_webhook_inbox")
      .update({
        process_status: "FAILED",
        process_error: "No shipment matched this organization and article_number.",
        processed_at: new Date().toISOString(),
      })
      .eq("id", inbox.id)
      .eq("organization_id", organizationId);
    return { processed: false, reason: "unknown-shipment" };
  }

  const mapped = mapIndiaPostEventToShipmentUpdate(parsed);
  const { error: eventError } = await supabase.from("tracking_events").insert({
    organization_id: organizationId,
    shipment_id: shipment.id,
    event_code: mapped.eventCode,
    event_description: mapped.eventDescription,
    office_name: parsed.officeName,
    office_id: parsed.officeId,
    occurred_at: parsed.eventTimestamp ?? inbox.received_at ?? new Date().toISOString(),
    raw: parsed.rawPayload,
  });
  if (eventError && eventError.code !== "23505") {
    throw Object.assign(new Error(eventError.message), { code: "TEMPORARY_PROVIDER_FAILURE" });
  }

  if (
    mapped.shouldUpdateStatus &&
    mapped.shipmentStatus &&
    canAdvanceShipmentStatus(shipment.status, mapped.shipmentStatus)
  ) {
    await supabase
      .from("shipments")
      .update({ status: mapped.shipmentStatus })
      .eq("id", shipment.id)
      .eq("organization_id", organizationId);
    if (shipment.order_id && (mapped.shipmentStatus === "IN_TRANSIT" || mapped.shipmentStatus === "DELIVERED")) {
      await supabase
        .from("orders")
        .update({ status: mapped.shipmentStatus })
        .eq("id", shipment.order_id)
        .eq("organization_id", organizationId);
      try {
        const { enqueueWatiNotify } = await import("@/modules/wati/send");
        await enqueueWatiNotify(
          supabase,
          organizationId,
          mapped.shipmentStatus === "DELIVERED" ? "delivered" : "in_transit",
          { shipmentId: shipment.id, orderId: shipment.order_id }
        );
      } catch {
        // WhatsApp is optional; tracking updates should still persist.
      }
      try {
        const { getAutomationSettings } = await import("@/modules/automation/service");
        const automation = await getAutomationSettings(supabase, organizationId);
        if (automation.autoShopifyFulfillment !== false) {
          const { syncShopifyOrderStage } = await import("@/modules/shopify/orders");
          await syncShopifyOrderStage(supabase, {
            organizationId,
            orderId: shipment.order_id,
            shipmentId: shipment.id,
            stage: mapped.shipmentStatus === "DELIVERED" ? "delivered" : "in_transit",
          });
        }
      } catch {
        // Shopify fulfillment events are optional; tracking updates should still persist.
      }
    }
    if (
      shipment.order_id &&
      (mapped.shipmentStatus === "DELIVERED" || mapped.shipmentStatus === "IN_TRANSIT")
    ) {
      try {
        const { insertOrderStageNotification } = await import("@/lib/notifications/order-stage");
        await insertOrderStageNotification(supabase, {
          organizationId,
          orderId: shipment.order_id,
          event: mapped.shipmentStatus === "DELIVERED" ? "delivered" : "in_transit",
          body: mapped.eventDescription ?? mapped.eventCode,
        });
      } catch {
        // In-app alerts are optional; tracking updates should still persist.
      }
    } else {
      await supabase.from("notifications").insert({
        organization_id: organizationId,
        type: "tracking.updated",
        title: "Shipment tracking updated",
        body: mapped.eventDescription ?? mapped.eventCode,
        entity_type: "shipment",
        entity_id: shipment.id,
      });
    }
  } else if (!eventError) {
    await supabase.from("notifications").insert({
      organization_id: organizationId,
      type: "tracking.updated",
      title: "Shipment tracking updated",
      body: mapped.eventDescription ?? mapped.eventCode,
      entity_type: "shipment",
      entity_id: shipment.id,
    });
  }

  if (!eventError) {
    await emitWebhook(supabase, organizationId, "tracking.updated", {
      shipmentId: shipment.id,
      eventCode: mapped.eventCode,
    });
  }

  await supabase
    .from("provider_webhook_inbox")
    .update({
      process_status: "PROCESSED",
      process_error: null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", inbox.id)
    .eq("organization_id", organizationId);

  logInfo("india_post.webhook.processed", {
    provider: "INDIA_POST",
    organizationId,
    inboxEventId: inbox.id,
    eventCode: mapped.eventCode,
    trackingNumber: maskTrackingNumber(parsed.barcode),
    statusUpdated: Boolean(mapped.shouldUpdateStatus && mapped.shipmentStatus),
  });

  return { processed: true, shipmentId: shipment.id };
}
