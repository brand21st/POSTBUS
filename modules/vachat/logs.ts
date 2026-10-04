import type { SupabaseClient } from "@supabase/supabase-js";
import type { WatiNotifyEvent } from "@/modules/wati/notify";

export type VachatLogStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "skipped";

export type VachatLogWrite = {
  organizationId: string;
  orderId?: string | null;
  shipmentId?: string | null;
  event: string;
  phone?: string | null;
  externalRef: string;
  status: VachatLogStatus;
  error?: string | null;
  vachatMessageId?: string | null;
  whatsappMessageId?: string | null;
};

export async function upsertVachatNotificationLog(
  supabase: SupabaseClient,
  row: VachatLogWrite
) {
  const { error } = await supabase.from("vachat_notification_logs").upsert(
    {
      organization_id: row.organizationId,
      order_id: row.orderId ?? null,
      shipment_id: row.shipmentId ?? null,
      event: row.event,
      phone: row.phone ?? null,
      external_ref: row.externalRef,
      status: row.status,
      error: row.error ?? null,
      vachat_message_id: row.vachatMessageId ?? null,
      whatsapp_message_id: row.whatsappMessageId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,external_ref" }
  );
  return error;
}

export async function updateVachatNotificationLogStatus(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    externalRef: string;
    status: string;
    vachatMessageId?: string | null;
    whatsappMessageId?: string | null;
    error?: string | null;
  }
) {
  const key = input.status.toLowerCase();
  const status: VachatLogStatus =
    key === "failed"
      ? "failed"
      : key === "delivered"
        ? "delivered"
        : key === "read"
          ? "read"
          : key === "sent"
            ? "sent"
            : "sent";
  const { error } = await supabase
    .from("vachat_notification_logs")
    .update({
      status,
      error: input.error ?? null,
      ...(input.vachatMessageId ? { vachat_message_id: input.vachatMessageId } : {}),
      ...(input.whatsappMessageId ? { whatsapp_message_id: input.whatsappMessageId } : {}),
    })
    .eq("organization_id", input.organizationId)
    .eq("external_ref", input.externalRef);
  return error;
}

export const VACHAT_PERMANENT_NOTIFY_CODES = new Set([
  "notification_disabled",
  "template_missing",
  "template_malformed",
  "whatsapp_not_configured",
  "bad_request",
  "invalid_merchant_mapping",
  "VALIDATION_ERROR",
]);

export function isPermanentVachatNotifyFailure(code: string | undefined, status?: number) {
  if (code && VACHAT_PERMANENT_NOTIFY_CODES.has(code)) return true;
  if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) return true;
  return false;
}

function countByStatus(rows: Array<{ status?: string | null }>) {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = (row.status || "unknown").toLowerCase();
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export async function vachatNotificationStats(supabase: SupabaseClient) {
  const now = new Date();
  const since = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const [today, week, month] = await Promise.all([
    supabase.from("vachat_notification_logs").select("status").gte("created_at", todayStart),
    supabase.from("vachat_notification_logs").select("status").gte("created_at", since(7)),
    supabase.from("vachat_notification_logs").select("status").gte("created_at", since(30)),
  ]);
  return {
    today: countByStatus(today.data ?? []),
    last7d: countByStatus(week.data ?? []),
    last30d: countByStatus(month.data ?? []),
  };
}

export async function listVachatNotificationLogs(
  supabase: SupabaseClient,
  input?: { organizationId?: string | null; limit?: number }
) {
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
  let query = supabase
    .from("vachat_notification_logs")
    .select(
      "id, organization_id, order_id, shipment_id, event, phone, external_ref, vachat_message_id, whatsapp_message_id, status, error, created_at, updated_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (input?.organizationId) {
    query = query.eq("organization_id", input.organizationId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
