import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { VACHAT_BUSINESS_WHATSAPP } from "@/modules/vachat/knowledge";

export const SUPPORT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export const SUPPORT_SESSION_STATES = [
  "IDENTIFY",
  "LIST_ELIGIBLE",
  "AWAIT_SELECTION",
  "ORDER_BOUND",
  "CONFIRM_ACTION",
  "EXPIRED",
] as const;

export type SupportSessionState = (typeof SUPPORT_SESSION_STATES)[number];

export type WhatsappSupportSession = {
  id: string;
  source: "platform";
  phone_digits: string;
  selected_order_id: string | null;
  selected_organization_id: string | null;
  state: SupportSessionState;
  expires_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

const TABLE = "whatsapp_support_sessions";
const SESSION_COLUMNS =
  "id, source, phone_digits, selected_order_id, selected_organization_id, state, expires_at, last_seen_at, created_at, updated_at";

export function sessionPhoneDigits(raw?: string | null) {
  const digits = extractIndiaMobileDigits(String(raw ?? "").trim());
  if (!digits) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter a valid Indian WhatsApp number.");
  }
  if (digits === extractIndiaMobileDigits(VACHAT_BUSINESS_WHATSAPP)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "The PostBus WhatsApp line cannot be a customer support session."
    );
  }
  return digits;
}

export function isSupportSessionExpired(
  row: Pick<WhatsappSupportSession, "expires_at" | "state">,
  now = new Date()
) {
  if (row.state === "EXPIRED") return true;
  const expires = Date.parse(row.expires_at);
  return Number.isFinite(expires) && expires <= now.getTime();
}

export function touchExpiry(now = new Date()) {
  const lastSeenAt = now.toISOString();
  return {
    last_seen_at: lastSeenAt,
    expires_at: new Date(now.getTime() + SUPPORT_SESSION_TTL_MS).toISOString(),
  };
}

function asSession(row: Record<string, unknown> | null | undefined): WhatsappSupportSession | null {
  if (!row?.id || !row.phone_digits) return null;
  const state = String(row.state ?? "IDENTIFY") as SupportSessionState;
  return {
    id: String(row.id),
    source: "platform",
    phone_digits: String(row.phone_digits),
    selected_order_id: row.selected_order_id ? String(row.selected_order_id) : null,
    selected_organization_id: row.selected_organization_id
      ? String(row.selected_organization_id)
      : null,
    state: SUPPORT_SESSION_STATES.includes(state) ? state : "IDENTIFY",
    expires_at: String(row.expires_at),
    last_seen_at: String(row.last_seen_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

async function loadByPhone(supabase: SupabaseClient, phoneDigits: string) {
  const { data, error } = await supabase
    .from(TABLE)
    .select(SESSION_COLUMNS)
    .eq("phone_digits", phoneDigits)
    .maybeSingle();
  if (error) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Unable to load the WhatsApp support session.");
  }
  return asSession(data as Record<string, unknown> | null);
}

async function loadById(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from(TABLE).select(SESSION_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Unable to load the WhatsApp support session.");
  }
  return asSession(data as Record<string, unknown> | null);
}

async function insertSession(supabase: SupabaseClient, phoneDigits: string, now: Date) {
  const stamp = now.toISOString();
  const touch = touchExpiry(now);
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      source: "platform",
      phone_digits: phoneDigits,
      selected_order_id: null,
      selected_organization_id: null,
      state: "IDENTIFY",
      created_at: stamp,
      updated_at: stamp,
      ...touch,
    })
    .select(SESSION_COLUMNS)
    .single();
  if (error || !data) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Unable to create the WhatsApp support session.");
  }
  return asSession(data as Record<string, unknown>)!;
}

async function updateSession(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>
) {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(SESSION_COLUMNS)
    .single();
  if (error || !data) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Unable to update the WhatsApp support session.");
  }
  return asSession(data as Record<string, unknown>)!;
}

export async function getSupportSessionByPhone(supabase: SupabaseClient, rawPhone: string) {
  return loadByPhone(supabase, sessionPhoneDigits(rawPhone));
}

export async function findSupportSessionById(supabase: SupabaseClient, id: string) {
  return loadById(supabase, id);
}

export async function getSupportSessionById(supabase: SupabaseClient, id: string) {
  const session = await loadById(supabase, id);
  if (!session) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "WhatsApp support session was not found.");
  }
  return session;
}

export async function bindSupportSessionOrder(
  supabase: SupabaseClient,
  sessionId: string,
  binding: { orderId: string; organizationId: string },
  now = new Date()
) {
  return updateSession(supabase, sessionId, {
    selected_order_id: binding.orderId,
    selected_organization_id: binding.organizationId,
    state: "ORDER_BOUND",
    ...touchExpiry(now),
  });
}

export async function setSupportSessionState(
  supabase: SupabaseClient,
  sessionId: string,
  state: Extract<SupportSessionState, "LIST_ELIGIBLE" | "AWAIT_SELECTION">,
  now = new Date()
) {
  return updateSession(supabase, sessionId, {
    state,
    ...touchExpiry(now),
  });
}

export async function getOrCreateSupportSession(
  supabase: SupabaseClient,
  rawPhone: string,
  now = new Date()
) {
  const phoneDigits = sessionPhoneDigits(rawPhone);
  const existing = await loadByPhone(supabase, phoneDigits);
  if (!existing) {
    return insertSession(supabase, phoneDigits, now);
  }
  if (isSupportSessionExpired(existing, now)) {
    return updateSession(supabase, existing.id, {
      state: "IDENTIFY",
      selected_order_id: null,
      selected_organization_id: null,
      ...touchExpiry(now),
    });
  }
  return updateSession(supabase, existing.id, touchExpiry(now));
}
