import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { toIndiaWhatsappE164 } from "@/lib/phone/india-whatsapp";
import { WATI_NOTIFY_EVENTS, type WatiNotifyEvent } from "@/modules/wati/notify";
import { loadNoticeContext, resolveWatiTrackingUrl } from "@/modules/wati/send";
import { getTrackingPage } from "@/modules/tracking-pages/service";
import { isAutoWatiEventEnabled } from "@/modules/automation/service";
import { vachatHeaders, type VachatConnectionRow } from "@/modules/vachat/service";
import {
  getPlatformVachatConfig,
  isPlatformVachatActive,
  resolveVachatSendCredentials,
} from "@/modules/vachat/platform-config";
import {
  isPermanentVachatNotifyFailure,
  upsertVachatNotificationLog,
} from "@/modules/vachat/logs";

export const VACHAT_DEFAULT_TEST_PHONE = "918618456029";

export type VachatNotifyIds = {
  orderId?: string | null;
  shipmentId?: string | null;
};

export function vachatExternalRef(event: WatiNotifyEvent, ids: VachatNotifyIds) {
  const entity = ids.shipmentId ?? ids.orderId ?? "unknown";
  return `postbus:${event}:${entity}`;
}

export function vachatRecipientE164(raw?: string | null) {
  const trimmed = raw?.trim() || "";
  if (!trimmed) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter a TEST WhatsApp number.");
  }
  try {
    return toIndiaWhatsappE164(trimmed);
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter a 10-digit Indian WhatsApp number.");
  }
}

async function isVachatEventAllowed(
  supabase: SupabaseClient,
  organizationId: string,
  event: WatiNotifyEvent
) {
  const platform = await getPlatformVachatConfig();
  if (isPlatformVachatActive(platform)) {
    return Boolean(platform.eventSettings[event]);
  }
  return isAutoWatiEventEnabled(supabase, organizationId, event);
}

async function postVachatNotification(
  creds: { apiKey: string; apiBaseUrl: string },
  payload: Record<string, unknown>
) {
  const baseUrl = creds.apiBaseUrl.replace(/\/$/, "");
  const res = await fetch(`${baseUrl}/api/postbus/notifications`, {
    method: "POST",
    headers: vachatHeaders(creds.apiKey),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const json = (await res.json().catch(() => null)) as {
    data?: {
      message_id?: string;
      whatsapp_message_id?: string;
      duplicate?: boolean;
    };
    error?: { code?: string; message?: string };
  } | null;
  if (!res.ok) {
    const message =
      json?.error?.message || `Vachat notify failed (${res.status})`;
    const err = new Error(message) as Error & { status: number; code: string };
    err.status = res.status;
    err.code = json?.error?.code || `HTTP_${res.status}`;
    throw err;
  }
  return {
    sent: true as const,
    duplicate: Boolean(json?.data?.duplicate),
    messageId: json?.data?.message_id ?? null,
    whatsappMessageId: json?.data?.whatsapp_message_id ?? null,
  };
}

async function loadOrgVachatRow(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("vachat_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return (data as VachatConnectionRow | null) ?? null;
}

export async function sendVachatNotice(
  supabase: SupabaseClient,
  organizationId: string,
  event: WatiNotifyEvent,
  ids: VachatNotifyIds
) {
  const externalRef = vachatExternalRef(event, ids);
  if (!(await isVachatEventAllowed(supabase, organizationId, event))) {
    await upsertVachatNotificationLog(supabase, {
      organizationId,
      orderId: ids.orderId,
      shipmentId: ids.shipmentId,
      event,
      externalRef,
      status: "skipped",
      error: "event_disabled",
    });
    return { skipped: true, reason: "event_disabled" };
  }
  const connection = await loadOrgVachatRow(supabase, organizationId);
  const creds = await resolveVachatSendCredentials(organizationId, connection);
  if (!creds) {
    return { skipped: true };
  }

  const context = await loadNoticeContext(supabase, organizationId, ids);
  if (!context) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order or shipment not found for Vachat notify.");
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();

  const trackingNumber = context.trackingNumber ?? context.barcode;
  const trackingPage = await getTrackingPage(supabase, organizationId).catch(() => null);
  const trackingUrl = resolveWatiTrackingUrl(trackingNumber, trackingPage);
  const phone = context.phone?.trim();
  if (!phone) {
    await upsertVachatNotificationLog(supabase, {
      organizationId,
      orderId: ids.orderId,
      shipmentId: ids.shipmentId,
      event,
      externalRef,
      status: "failed",
      error: "missing_phone",
    });
    return { skipped: true, reason: "missing_phone" };
  }

  try {
    const result = await postVachatNotification(creds, {
      merchant_id: organizationId,
      notification_type: event,
      external_ref: externalRef,
      to: phone.startsWith("+") ? phone : `+91${phone.replace(/\D/g, "").slice(-10)}`,
      customer_name: context.customerName,
      shop_name: org?.name,
      order_number: context.orderNumber,
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      order_id: ids.orderId ?? context.orderNumber,
      shipment_id: ids.shipmentId,
    });
    await upsertVachatNotificationLog(supabase, {
      organizationId,
      orderId: ids.orderId,
      shipmentId: ids.shipmentId,
      event,
      phone,
      externalRef,
      status: "sent",
      vachatMessageId: result.messageId,
      whatsappMessageId: result.whatsappMessageId,
    });
    return result;
  } catch (error) {
    const anyError = error as { status?: number; code?: string; message?: string };
    await upsertVachatNotificationLog(supabase, {
      organizationId,
      orderId: ids.orderId,
      shipmentId: ids.shipmentId,
      event,
      phone,
      externalRef,
      status: "failed",
      error: anyError.message?.slice(0, 240) ?? "send_failed",
    });
    if (isPermanentVachatNotifyFailure(anyError.code, anyError.status)) {
      return { skipped: true, reason: anyError.code ?? "permanent_failure" };
    }
    throw error;
  }
}

export async function sendVachatTestNotice(
  supabase: SupabaseClient,
  organizationId: string,
  input?: { phone?: string | null; event?: string | null; shopName?: string | null }
) {
  const connection = await loadOrgVachatRow(supabase, organizationId);
  const creds = await resolveVachatSendCredentials(organizationId, connection);
  if (!creds) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Connect VaChat before sending a test WhatsApp.");
  }
  const event =
    input?.event && (WATI_NOTIFY_EVENTS as readonly string[]).includes(input.event)
      ? (input.event as WatiNotifyEvent)
      : "booked";
  const to = vachatRecipientE164(input?.phone);
  const { data: org } = await supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle();
  const trackingPage = await getTrackingPage(supabase, organizationId).catch(() => null);
  const trackingUrl = resolveWatiTrackingUrl("TESTTRACKIN", trackingPage);
  await postVachatNotification(creds, {
    merchant_id: organizationId,
    notification_type: event,
    external_ref: `postbus:test:${event}:${organizationId}:${Date.now()}`,
    to,
    customer_name: "Test customer",
    shop_name: input?.shopName ?? org?.name ?? "PostBus",
    order_number: "TEST-001",
    tracking_number: "TESTTRACKIN",
    tracking_url: trackingUrl,
  });
  return { sent: true, to, event };
}

export async function enqueueVachatNotify(
  supabase: SupabaseClient,
  organizationId: string,
  event: WatiNotifyEvent,
  ids: VachatNotifyIds
) {
  if (!(await isVachatEventAllowed(supabase, organizationId, event))) return;
  const connection = await loadOrgVachatRow(supabase, organizationId);
  const creds = await resolveVachatSendCredentials(organizationId, connection);
  if (!creds) return;
  const entityId = ids.shipmentId ?? ids.orderId;
  if (!entityId) return;
  if (!(WATI_NOTIFY_EVENTS as readonly string[]).includes(event)) return;
  if (await hasOpenVachatNotifyJob(supabase, organizationId, event, ids)) return;
  const { createBackgroundJob } = await import("@/modules/jobs/service");
  await createBackgroundJob(supabase, {
    organizationId,
    jobType: "vachat-notify",
    entityType: ids.shipmentId ? "shipment" : "order",
    entityId,
    progress: { event, shipmentId: ids.shipmentId ?? null, orderId: ids.orderId ?? null },
  });
}

export function isDuplicateVachatNotifyJob(
  jobs: Array<{ entity_id?: string | null; progress?: unknown }>,
  event: WatiNotifyEvent,
  ids: VachatNotifyIds
) {
  return jobs.some((job) => {
    const progress = job.progress && typeof job.progress === "object" ? (job.progress as { event?: string }) : {};
    if (progress.event !== event) return false;
    const fromJob = vachatIdsFromJob(job.progress, job.entity_id);
    if (ids.orderId && (fromJob.orderId === ids.orderId || job.entity_id === ids.orderId)) return true;
    if (ids.shipmentId && (fromJob.shipmentId === ids.shipmentId || job.entity_id === ids.shipmentId)) {
      return true;
    }
    return false;
  });
}

async function hasOpenVachatNotifyJob(
  supabase: SupabaseClient,
  organizationId: string,
  event: WatiNotifyEvent,
  ids: VachatNotifyIds
) {
  const entityIds = [ids.shipmentId, ids.orderId].filter((value): value is string => Boolean(value));
  if (!entityIds.length) return false;
  const { data } = await supabase
    .from("background_jobs")
    .select("entity_id, progress")
    .eq("organization_id", organizationId)
    .eq("job_type", "vachat-notify")
    .in("entity_id", entityIds)
    .in("status", ["QUEUED", "PENDING", "RUNNING", "RETRYING", "SUCCEEDED"]);
  return isDuplicateVachatNotifyJob(data ?? [], event, ids);
}

export function vachatEventFromJobProgress(progress: unknown): WatiNotifyEvent {
  const event =
    progress && typeof progress === "object" ? (progress as { event?: string }).event : undefined;
  if (event && (WATI_NOTIFY_EVENTS as readonly string[]).includes(event)) {
    return event as WatiNotifyEvent;
  }
  return "booked";
}

export function vachatIdsFromJob(progress: unknown, fallbackId?: string | null): VachatNotifyIds {
  const record = progress && typeof progress === "object" ? (progress as VachatNotifyIds) : {};
  return {
    shipmentId: record.shipmentId ?? (fallbackId && !record.orderId ? fallbackId : null),
    orderId: record.orderId ?? null,
  };
}
