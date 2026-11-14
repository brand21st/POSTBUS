import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { loadSheetsCrmConfig, sheetsCrmReady } from "@/modules/sheets-crm/config";
import {
  activitySyncDue,
  openDedupeKey,
  type SheetsCrmEventType,
} from "@/modules/sheets-crm/events";

export type EnqueueSheetsCrmInput = {
  eventType: SheetsCrmEventType;
  customerId?: string | null;
  organizationId?: string | null;
  force?: boolean;
};

async function resolveCustomerId(supabase: SupabaseClient, input: EnqueueSheetsCrmInput) {
  if (input.customerId) return input.customerId;
  if (!input.organizationId) return null;
  const { data, error } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", input.organizationId)
    .eq("role", "OWNER")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.user_id ?? null;
}

async function isPartnerOnly(supabase: SupabaseClient, customerId: string) {
  const { data: partner, error } = await supabase
    .from("affiliate_profiles")
    .select("user_id")
    .eq("user_id", customerId)
    .maybeSingle();
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("does not exist") || message.includes("schema cache")) return false;
    throw new Error(error.message);
  }
  if (!partner) return false;
  const { count, error: memberError } = await supabase
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("user_id", customerId);
  if (memberError) throw new Error(memberError.message);
  return (count ?? 0) === 0;
}

export async function enqueueSheetsCrmEvent(supabase: SupabaseClient, input: EnqueueSheetsCrmInput) {
  const config = await loadSheetsCrmConfig(supabase);
  if (!sheetsCrmReady(config)) return { queued: false as const, reason: "not_ready" as const };
  const customerId = await resolveCustomerId(supabase, input);
  if (!customerId) return { queued: false as const, reason: "missing_customer" as const };
  if (await isPartnerOnly(supabase, customerId)) return { queued: false as const, reason: "partner_only" as const };

  if (input.eventType === "customer.activity.updated" && !input.force) {
    const { data, error } = await supabase
      .from("sheets_crm_projections")
      .select("last_activity_enqueued_at")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!activitySyncDue(data?.last_activity_enqueued_at, Date.now())) {
      return { queued: false as const, reason: "throttled" as const };
    }
  }

  const eventId = `evt_${randomUUID()}`;
  const dedupeKey = openDedupeKey(customerId);
  const { error } = await supabase.from("sheets_crm_outbox").insert({
    event_id: eventId,
    event_type: input.eventType,
    customer_id: customerId,
    organization_id: input.organizationId ?? null,
    dedupe_key: dedupeKey,
    status: "PENDING",
    force: Boolean(input.force),
  });
  if (error?.code === "23505") {
    if (input.force) {
      await supabase
        .from("sheets_crm_outbox")
        .update({ force: true, event_type: input.eventType, updated_at: new Date().toISOString() })
        .eq("dedupe_key", dedupeKey)
        .in("status", ["PENDING", "FAILED"]);
    }
    if (input.eventType === "customer.activity.updated") {
      await touchActivity(supabase, customerId);
    }
    return { queued: false as const, reason: "duplicate" as const, customerId };
  }
  if (error) throw new Error(error.message);
  if (input.eventType === "customer.activity.updated") await touchActivity(supabase, customerId);
  return { queued: true as const, eventId, customerId };
}

async function touchActivity(supabase: SupabaseClient, customerId: string) {
  const now = new Date().toISOString();
  await supabase.from("sheets_crm_projections").upsert(
    { customer_id: customerId, last_activity_enqueued_at: now, updated_at: now },
    { onConflict: "customer_id" }
  );
}

export function scheduleSheetsCrmEvent(input: EnqueueSheetsCrmInput) {
  if (process.env.VITEST) return;
  void enqueueFromAdmin(input).catch((error) => {
    logError("sheets_crm.enqueue_failed", {
      eventType: input.eventType,
      message: error instanceof Error ? error.message : "enqueue failed",
    });
  });
}

async function enqueueFromAdmin(input: EnqueueSheetsCrmInput) {
  if (!hasAdminClient()) return;
  try {
    await enqueueSheetsCrmEvent(createAdminClient(), input);
  } catch (error) {
    logError("sheets_crm.enqueue_failed", {
      eventType: input.eventType,
      message: error instanceof Error ? error.message : "enqueue failed",
    });
  }
}
