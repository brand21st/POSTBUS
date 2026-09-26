import { createHash } from "crypto";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError, logInfo } from "@/lib/logger";
import { createBackgroundJob } from "@/modules/jobs/service";
import { emitWebhook } from "@/modules/webhooks/outgoing";
import { applyIndiaPostTracking, snapshotFromShipmentRow } from "@/modules/india-post/apply-tracking";
import { enqueueTrackingStageSideEffects } from "@/modules/india-post/tracking-effects";
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
    .select(
      "id, organization_id, status, barcode, tracking_number, order_id, operational_status, last_event_at, ndr_attempt_count, rto_initiated_at"
    )
    .eq("organization_id", organizationId)
    .eq("barcode", parsed.barcode)
    .maybeSingle();
  const { data: byTracking } = byBarcode
    ? { data: byBarcode }
    : await supabase
        .from("shipments")
        .select(
          "id, organization_id, status, barcode, tracking_number, order_id, operational_status, last_event_at, ndr_attempt_count, rto_initiated_at"
        )
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

  const applied = await applyIndiaPostTracking(
    supabase,
    snapshotFromShipmentRow(shipment, organizationId),
    {
      eventCode: parsed.eventCode || "EVENT",
      eventDescription: parsed.eventDescription,
      officeName: parsed.officeName,
      officeId: parsed.officeId,
      occurredAt: parsed.eventTimestamp ?? inbox.received_at ?? new Date().toISOString(),
      raw: parsed.rawPayload,
      nonDeliveryReason: parsed.nonDeliveryReason,
    }
  );

  if (applied.orderStatus && shipment.order_id) {
    await enqueueTrackingStageSideEffects(supabase, {
      organizationId,
      shipmentId: shipment.id,
      orderId: shipment.order_id,
      orderStatus: applied.orderStatus,
      body: parsed.eventDescription ?? parsed.eventCode,
    });
  } else if (applied.inserted) {
    await supabase.from("notifications").insert({
      organization_id: organizationId,
      type: "tracking.updated",
      title: "Shipment tracking updated",
      body: parsed.eventDescription ?? parsed.eventCode,
      entity_type: "shipment",
      entity_id: shipment.id,
    });
  }

  if (applied.inserted) {
    await emitWebhook(supabase, organizationId, "tracking.updated", {
      shipmentId: shipment.id,
      eventCode: parsed.eventCode,
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
    eventCode: parsed.eventCode,
    trackingNumber: maskTrackingNumber(parsed.barcode),
    statusUpdated: applied.statusUpdated,
  });

  return { processed: true, shipmentId: shipment.id };
}
