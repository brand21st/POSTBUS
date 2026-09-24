import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { indiaPostPublicTrackingUrl } from "@/modules/india-post/barcode";
import { customerTrackingLink } from "@/modules/tracking-pages/host";
import { getTrackingPage } from "@/modules/tracking-pages/service";
import { watiClientFromRow } from "@/modules/wati/client";
import { listWatiTemplates } from "@/modules/wati/service";
import {
  WATI_NOTIFY_EVENTS,
  watiBroadcastName,
  watiNotifyRecipient,
  watiTemplateForEvent,
  type WatiNotifyEvent,
  type WatiTemplateMap,
} from "@/modules/wati/notify";

export type WatiNotifyIds = {
  orderId?: string | null;
  shipmentId?: string | null;
};

const TEMPLATE_COLUMNS =
  "status, order_confirmation_template_name, processing_template_name, booked_template_name, in_transit_template_name, delivered_template_name";

export function resolveWatiTrackingUrl(
  trackingNumber: string | null | undefined,
  trackingPage?: { status?: string | null; publicUrl?: string | null } | null
) {
  const tracking = trackingNumber?.trim();
  if (!tracking) return null;
  if (trackingPage?.status === "PUBLISHED" && trackingPage.publicUrl) {
    return customerTrackingLink(trackingPage.publicUrl, tracking);
  }
  return indiaPostPublicTrackingUrl(tracking);
}

async function loadWatiTrackingUrl(
  supabase: SupabaseClient,
  organizationId: string,
  trackingNumber: string | null | undefined
) {
  if (!trackingNumber?.trim()) return null;
  const trackingPage = await getTrackingPage(supabase, organizationId).catch(() => null);
  return resolveWatiTrackingUrl(trackingNumber, trackingPage);
}

export async function sendWatiNotice(
  supabase: SupabaseClient,
  organizationId: string,
  event: WatiNotifyEvent,
  ids: WatiNotifyIds
) {
  const { data: connection } = await supabase
    .from("wati_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!connection?.encrypted_api_token || connection.status !== "CONNECTED") return { skipped: true };

  const templateName = watiTemplateForEvent(event, connection);
  if (!templateName) return { skipped: true };

  const context = await loadNoticeContext(supabase, organizationId, ids);
  if (!context) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order or shipment not found for Wati notify.");
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();
  const trackingNumber = context.trackingNumber ?? context.barcode;
  const templates = await listWatiTemplates(connection).catch(() => []);
  const template = templates.find((item) => item.name === templateName);
  if (!template) return { skipped: true, reason: "not_approved_utility" };
  const recipient = watiNotifyRecipient(
    {
      customerName: context.customerName,
      shopName: org?.name,
      phone: context.phone,
      orderNumber: context.orderNumber,
      trackingNumber,
      barcode: context.barcode,
      trackingUrl: await loadWatiTrackingUrl(supabase, organizationId, trackingNumber),
    },
    template
  );
  if (!recipient) return { skipped: true, reason: "missing_phone" };

  const client = watiClientFromRow(connection);
  await client.sendTemplateMessages({
    template_name: templateName,
    broadcast_name: watiBroadcastName(event, trackingNumber ?? context.orderNumber),
    recipients: [recipient],
    channel: connection.channel_phone ?? undefined,
  });
  return { sent: true, templateName };
}

export async function sendWatiShipmentNotice(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentId: string,
  event: WatiNotifyEvent
) {
  return sendWatiNotice(supabase, organizationId, event, { shipmentId });
}

function firstRelated<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function loadNoticeContext(
  supabase: SupabaseClient,
  organizationId: string,
  ids: WatiNotifyIds
) {
  if (ids.shipmentId) {
    const { data: shipment } = await supabase
      .from("shipments")
      .select("id, barcode, tracking_number, order_id, addresses(name, phone), customers(name, phone), orders(order_number)")
      .eq("organization_id", organizationId)
      .eq("id", ids.shipmentId)
      .maybeSingle();
    if (!shipment) return null;
    const address = firstRelated(shipment.addresses);
    const customer = firstRelated(shipment.customers);
    const order = firstRelated(shipment.orders);
    return {
      customerName: address?.name ?? customer?.name ?? null,
      phone: address?.phone ?? customer?.phone ?? null,
      orderNumber: order?.order_number ?? null,
      trackingNumber: shipment.tracking_number ?? shipment.barcode ?? null,
      barcode: shipment.barcode ?? null,
    };
  }

  if (ids.orderId) {
    const { data: order } = await supabase
      .from("orders")
      .select("id, order_number, customers(name, phone), addresses:shipping_address_id(name, phone)")
      .eq("organization_id", organizationId)
      .eq("id", ids.orderId)
      .maybeSingle();
    if (!order) return null;
    const address = firstRelated(order.addresses);
    const customer = firstRelated(order.customers);
    return {
      customerName: address?.name ?? customer?.name ?? null,
      phone: address?.phone ?? customer?.phone ?? null,
      orderNumber: order.order_number ?? null,
      trackingNumber: null,
      barcode: null,
    };
  }

  return null;
}

export async function enqueueWatiNotify(
  supabase: SupabaseClient,
  organizationId: string,
  event: WatiNotifyEvent,
  ids: WatiNotifyIds
) {
  const { data } = await supabase
    .from("wati_connections")
    .select(TEMPLATE_COLUMNS)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data || data.status !== "CONNECTED") return;
  if (!watiTemplateForEvent(event, data as WatiTemplateMap)) return;
  const { isAutoWatiEventEnabled } = await import("@/modules/automation/service");
  if (!(await isAutoWatiEventEnabled(supabase, organizationId, event))) return;
  const entityId = ids.shipmentId ?? ids.orderId;
  if (!entityId) return;
  if (await hasOpenWatiNotifyJob(supabase, organizationId, event, ids)) return;
  const { createBackgroundJob } = await import("@/modules/jobs/service");
  await createBackgroundJob(supabase, {
    organizationId,
    jobType: "wati-notify",
    entityType: ids.shipmentId ? "shipment" : "order",
    entityId,
    progress: { event, shipmentId: ids.shipmentId ?? null, orderId: ids.orderId ?? null },
  });
}

export function isDuplicateWatiNotifyJob(
  jobs: Array<{ entity_id?: string | null; progress?: unknown }>,
  event: WatiNotifyEvent,
  ids: WatiNotifyIds
) {
  return jobs.some((job) => {
    if (watiEventFromJobProgress(job.progress) !== event) return false;
    const fromJob = watiIdsFromJob(job.progress, job.entity_id);
    if (ids.orderId && (fromJob.orderId === ids.orderId || job.entity_id === ids.orderId)) return true;
    if (ids.shipmentId && (fromJob.shipmentId === ids.shipmentId || job.entity_id === ids.shipmentId)) {
      return true;
    }
    return false;
  });
}

async function hasOpenWatiNotifyJob(
  supabase: SupabaseClient,
  organizationId: string,
  event: WatiNotifyEvent,
  ids: WatiNotifyIds
) {
  const entityIds = [ids.shipmentId, ids.orderId].filter((value): value is string => Boolean(value));
  if (!entityIds.length) return false;
  const { data } = await supabase
    .from("background_jobs")
    .select("entity_id, progress")
    .eq("organization_id", organizationId)
    .eq("job_type", "wati-notify")
    .in("entity_id", entityIds)
    .in("status", ["QUEUED", "PENDING", "RUNNING", "RETRYING", "SUCCEEDED"]);
  return isDuplicateWatiNotifyJob(data ?? [], event, ids);
}

export function watiEventFromJobProgress(progress: unknown): WatiNotifyEvent {
  const event =
    progress && typeof progress === "object" ? (progress as { event?: string }).event : undefined;
  if (event && (WATI_NOTIFY_EVENTS as readonly string[]).includes(event)) {
    return event as WatiNotifyEvent;
  }
  return "booked";
}

export function watiIdsFromJob(progress: unknown, fallbackId?: string | null): WatiNotifyIds {
  const record = progress && typeof progress === "object" ? (progress as WatiNotifyIds) : {};
  return {
    shipmentId: record.shipmentId ?? (fallbackId && !record.orderId ? fallbackId : null),
    orderId: record.orderId ?? null,
  };
}
