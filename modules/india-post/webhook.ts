import { createHash } from "crypto";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError, logInfo } from "@/lib/logger";
import { createBackgroundJob } from "@/modules/jobs/service";
import { emitWebhook } from "@/modules/webhooks/outgoing";
import { applyIndiaPostTracking, snapshotFromShipmentRow, trackingEventRaw } from "@/modules/india-post/apply-tracking";
import { enqueueTrackingStageSideEffects } from "@/modules/india-post/tracking-effects";
import {
  assertIndiaPostWebhookSourceAllowed,
  isIndiaPostWebhookQuarantined,
  webhookSourceIp,
} from "@/modules/india-post/webhook-allowlist";
import {
  maskTrackingNumber,
  parseIndiaPostWebhook,
  safeWebhookHeaders,
  type IndiaPostWebhookChannel,
  type ParsedIndiaPostWebhook,
} from "@/modules/india-post/webhook-parser";
import { isIndiaPostWebhookConnectionUuid } from "@/modules/india-post/webhook-urls";
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

type WebhookConnection = {
  id: string;
  organization_id: string;
  bulk_customer_id?: string | null;
  environment?: string | null;
};

const WEBHOOK_CONNECTION_COLUMNS = "id, organization_id, bulk_customer_id, environment";

export function isIndiaPostWebhookProductionEnvironment(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase() === "PRODUCTION";
}

type ArticleShipment = {
  id: string;
  organization_id: string;
  barcode?: string | null;
  tracking_number?: string | null;
};

const SHIPMENT_LOOKUP_COLUMNS =
  "id, organization_id, status, barcode, tracking_number, order_id, operational_status, last_event_at, ndr_attempt_count, rto_initiated_at";

async function rowsFor<T>(query: PromiseLike<{ data: T[] | T | null; error: { message?: string } | null }>) {
  const { data, error } = await query;
  if (error) return [] as T[];
  if (!data) return [] as T[];
  return Array.isArray(data) ? data : [data];
}

export async function findShipmentByArticle(
  supabase: ReturnType<typeof createAdminClient>,
  article: string | null
): Promise<ArticleShipment[]> {
  if (!article || !/^[A-Za-z0-9]{5,50}$/.test(article)) return [];
  const byBarcode = await rowsFor<ArticleShipment>(
    supabase
      .from("shipments")
      .select("id, organization_id, barcode, tracking_number")
      .eq("barcode", article)
      .limit(8) as never
  );
  const byTracking = await rowsFor<ArticleShipment>(
    supabase
      .from("shipments")
      .select("id, organization_id, barcode, tracking_number")
      .eq("tracking_number", article)
      .limit(8) as never
  );
  const byId = new Map<string, ArticleShipment>();
  for (const row of [...byBarcode, ...byTracking]) {
    if (row.id) byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function assertWebhookArticleTenant(
  supabase: ReturnType<typeof createAdminClient>,
  input: { barcode: string | null; organizationId: string; connectionId: string }
) {
  const rows = await findShipmentByArticle(supabase, input.barcode);
  if (rows.some((row) => row.organization_id !== input.organizationId)) {
    logInfo("india_post.webhook.tenant_rejected", {
      provider: "INDIA_POST",
      reason: "article_organization_mismatch",
      connectionId: input.connectionId,
      trackingNumber: maskTrackingNumber(input.barcode),
    });
    throw new AppError(ERROR_CODES.FORBIDDEN, "Webhook article does not belong to this customer.");
  }
}

async function resolveProductionWebhookConnection(
  supabase: ReturnType<typeof createAdminClient>,
  connectionId: string
): Promise<WebhookConnection> {
  if (isIndiaPostWebhookConnectionUuid(connectionId)) {
    const { data } = await supabase
      .from("india_post_connections")
      .select(WEBHOOK_CONNECTION_COLUMNS)
      .eq("id", connectionId)
      .maybeSingle();
    const row = (data as WebhookConnection | null) ?? null;
    if (!row) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
    }
    if (!isIndiaPostWebhookProductionEnvironment(row.environment)) {
      logInfo("india_post.webhook.tenant_rejected", {
        provider: "INDIA_POST",
        reason: "uat_connection",
        connectionId: row.id,
      });
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
    }
    return row;
  }

  const matches = (
    await rowsFor<WebhookConnection>(
      supabase
        .from("india_post_connections")
        .select(WEBHOOK_CONNECTION_COLUMNS)
        .eq("bulk_customer_id", connectionId)
        .eq("environment", "PRODUCTION")
        .limit(3) as never
    )
  ).filter((row) => isIndiaPostWebhookProductionEnvironment(row.environment));

  if (matches.length > 1) {
    logInfo("india_post.webhook.tenant_rejected", {
      provider: "INDIA_POST",
      reason: "ambiguous_production_connections",
      receivedConnectionId: connectionId,
    });
    throw new AppError(ERROR_CODES.FORBIDDEN, "Webhook customer id matches more than one production connection.");
  }
  if (!matches[0]) {
    logInfo("india_post.webhook.tenant_rejected", {
      provider: "INDIA_POST",
      reason: "no_production_connection",
      receivedConnectionId: connectionId,
    });
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
  }
  return matches[0];
}

export async function resolveIndiaPostWebhookTarget(
  supabase: ReturnType<typeof createAdminClient>,
  input: { connectionId: string; barcode: string | null; customerId: string | null }
): Promise<WebhookConnection> {
  const urlConnection = await resolveProductionWebhookConnection(supabase, input.connectionId);

  const payloadCustomer = String(input.customerId ?? "").trim();
  const urlCustomer = String(urlConnection.bulk_customer_id ?? "").trim();
  if (payloadCustomer && urlCustomer && payloadCustomer !== urlCustomer) {
    logInfo("india_post.webhook.tenant_rejected", {
      provider: "INDIA_POST",
      reason: "customer_mismatch",
      connectionId: urlConnection.id,
      trackingNumber: maskTrackingNumber(input.barcode),
    });
    throw new AppError(ERROR_CODES.FORBIDDEN, "Webhook customer id does not match this connection.");
  }

  await assertWebhookArticleTenant(supabase, {
    barcode: input.barcode,
    organizationId: urlConnection.organization_id,
    connectionId: urlConnection.id,
  });

  logInfo("india_post.webhook.production_resolved", {
    provider: "INDIA_POST",
    connectionId: urlConnection.id,
    receivedConnectionId: input.connectionId,
    environment: urlConnection.environment ?? "PRODUCTION",
  });
  return urlConnection;
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
  const sourceIp = webhookSourceIp(input.headers);
  if (isIndiaPostWebhookQuarantined()) {
    logInfo("india_post.webhook.quarantined", {
      provider: "INDIA_POST",
      connectionId: input.connectionId,
      channel: input.channel,
      sourceIp,
    });
    return { accepted: false, quarantined: true, duplicate: false, inboxEventId: null };
  }
  assertIndiaPostWebhookSourceAllowed(sourceIp);
  if (Buffer.byteLength(input.rawBody, "utf8") > INDIA_POST_WEBHOOK_MAX_BYTES) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Payload too large.");
  }

  const parsed = parseIndiaPostWebhook(input.rawBody, input.contentType, input.channel);
  const target = await resolveIndiaPostWebhookTarget(supabase, {
    connectionId: input.connectionId,
    barcode: parsed.barcode,
    customerId: parsed.customerId,
  });
  const hash = payloadHash(input.rawBody);
  const storedPayload = {
    ...parsed.rawPayload,
    _meta: {
      channel: input.channel,
      headers: safeWebhookHeaders(input.headers),
      parseError: parsed.parseError,
      receivedConnectionId: input.connectionId,
      routedConnectionId: target.id,
    },
  };

  const persist = await supabase.rpc("accept_india_post_webhook", {
    p_connection_id: target.id,
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
      connectionId: target.id,
      receivedConnectionId: input.connectionId,
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
        connectionId: target.id,
        organizationId: result.organization_id,
        inboxEventId,
        message: error instanceof Error ? error.message : "enqueue failed",
      });
    }
  }

  logInfo("india_post.webhook.accepted", {
    provider: "INDIA_POST",
    connectionId: target.id,
    receivedConnectionId: input.connectionId,
    channel: input.channel,
    sourceIp,
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
    logInfo("india_post.webhook.process_failed", {
      provider: "INDIA_POST",
      organizationId,
      inboxEventId: inbox.id,
      reason: "missing-barcode",
    });
    return { processed: false, reason: "missing-barcode" };
  }

  const { data: byBarcode } = await supabase
    .from("shipments")
    .select(SHIPMENT_LOOKUP_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("barcode", parsed.barcode)
    .maybeSingle();
  const { data: byTracking } = byBarcode
    ? { data: byBarcode }
    : await supabase
        .from("shipments")
        .select(SHIPMENT_LOOKUP_COLUMNS)
        .eq("organization_id", organizationId)
        .eq("tracking_number", parsed.barcode)
        .maybeSingle();
  const shipment = byBarcode ?? byTracking;

  if (!shipment || String(shipment.organization_id) !== organizationId) {
    await supabase
      .from("provider_webhook_inbox")
      .update({
        process_status: "FAILED",
        process_error: "No shipment matched this article_number.",
        processed_at: new Date().toISOString(),
      })
      .eq("id", inbox.id)
      .eq("organization_id", organizationId);
    logInfo("india_post.webhook.process_failed", {
      provider: "INDIA_POST",
      organizationId,
      inboxEventId: inbox.id,
      reason: "unknown-shipment",
      trackingNumber: maskTrackingNumber(parsed.barcode),
    });
    return { processed: false, reason: "unknown-shipment" };
  }

  const shipmentOrgId = String(shipment.organization_id);
  // A CEPT wall clock without an offset is not converted. Receipt time is a real UTC instant.
  const occurredAt = parsed.eventTimestamp ?? inbox.received_at ?? new Date().toISOString();
  const eventCode = parsed.eventCode || "EVENT";
  const applied = await applyIndiaPostTracking(
    supabase,
    snapshotFromShipmentRow(shipment, shipmentOrgId),
    {
      eventCode,
      eventDescription: parsed.eventDescription,
      officeName: parsed.officeName,
      officeId: parsed.officeId,
      occurredAt,
      raw: trackingEventRaw(parsed.rawPayload, "webhook"),
      nonDeliveryReason: parsed.nonDeliveryReason,
      rts: parsed.rawPayload.rts === true ? true : parsed.rawPayload.rts === false ? false : null,
    }
  );

  if (applied.whatsappEvents.length || applied.orderStatus) {
    await enqueueTrackingStageSideEffects(supabase, {
      organizationId: shipmentOrgId,
      shipmentId: shipment.id,
      orderId: shipment.order_id,
      orderStatus: applied.orderStatus,
      events: applied.whatsappEvents,
      notices: applied.whatsappEvents.map((event) => ({ event, eventCode, occurredAt })),
      body: parsed.eventDescription ?? parsed.eventCode,
    });
  } else if (applied.inserted) {
    await supabase.from("notifications").insert({
      organization_id: shipmentOrgId,
      type: "tracking.updated",
      title: "Shipment tracking updated",
      body: parsed.eventDescription ?? parsed.eventCode,
      entity_type: "shipment",
      entity_id: shipment.id,
    });
  }

  if (applied.inserted) {
    await emitWebhook(supabase, shipmentOrgId, "tracking.updated", {
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
    organizationId: shipmentOrgId,
    receivedOrganizationId: organizationId,
    inboxEventId: inbox.id,
    eventCode: parsed.eventCode,
    trackingNumber: maskTrackingNumber(parsed.barcode),
    statusUpdated: applied.statusUpdated,
    whatsappEvents: applied.whatsappEvents,
  });

  return { processed: true, shipmentId: shipment.id };
}
