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

  const { data: connection } = await supabase
    .from("india_post_connections")
    .select("id, organization_id, status, environment")
    .eq("id", input.connectionId)
    .maybeSingle();

  if (!connection) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
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

  const { data: existingHash } = await supabase
    .from("provider_webhook_inbox")
    .select("id")
    .eq("organization_id", connection.organization_id)
    .eq("payload_hash", hash)
    .maybeSingle();

  if (existingHash) {
    logInfo("india_post.webhook.duplicate", {
      provider: "INDIA_POST",
      connectionId: connection.id,
      organizationId: connection.organization_id,
      channel: input.channel,
      inboxEventId: existingHash.id,
      trackingNumber: maskTrackingNumber(parsed.barcode),
    });
    return { accepted: true, duplicate: true, inboxEventId: existingHash.id };
  }

  const insert = await supabase
    .from("provider_webhook_inbox")
    .insert({
      organization_id: connection.organization_id,
      connection_id: connection.id,
      provider: "INDIA_POST",
      channel: input.channel,
      provider_event_id: null,
      tracking_number: parsed.barcode,
      event_code: parsed.eventCode,
      event_timestamp: parsed.eventTimestamp,
      payload_hash: hash,
      raw_payload: storedPayload,
      process_status: "PENDING",
    })
    .select("id")
    .single();

  if (insert.error) {
    if (insert.error.code === "23505") {
      return { accepted: true, duplicate: true, inboxEventId: null };
    }
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Could not persist webhook event.");
  }

  try {
    await createBackgroundJob(supabase, {
      organizationId: connection.organization_id,
      jobType: "india-post-events",
      entityType: "provider_webhook_inbox",
      entityId: insert.data.id,
    });
  } catch (error) {
    logError("india_post.webhook.enqueue_failed", {
      provider: "INDIA_POST",
      connectionId: connection.id,
      organizationId: connection.organization_id,
      inboxEventId: insert.data.id,
      message: error instanceof Error ? error.message : "enqueue failed",
    });
  }

  logInfo("india_post.webhook.accepted", {
    provider: "INDIA_POST",
    connectionId: connection.id,
    organizationId: connection.organization_id,
    channel: input.channel,
    eventCode: parsed.eventCode,
    trackingNumber: maskTrackingNumber(parsed.barcode),
    inboxEventId: insert.data.id,
    parseError: parsed.parseError,
  });

  return { accepted: true, duplicate: false, inboxEventId: insert.data.id };
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
    .select("id, organization_id, status, barcode, tracking_number")
    .eq("organization_id", organizationId)
    .eq("barcode", parsed.barcode)
    .maybeSingle();
  const { data: byTracking } = byBarcode
    ? { data: byBarcode }
    : await supabase
        .from("shipments")
        .select("id, organization_id, status, barcode, tracking_number")
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
    await supabase.from("notifications").insert({
      organization_id: organizationId,
      type: mapped.shipmentStatus === "DELIVERED" ? "shipment.delivered" : "tracking.updated",
      title:
        mapped.shipmentStatus === "DELIVERED" ? "Shipment delivered" : "Shipment tracking updated",
      body: mapped.eventDescription ?? mapped.eventCode,
      entity_type: "shipment",
      entity_id: shipment.id,
    });
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
