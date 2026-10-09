import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";

export const SUPPORT_IDENTITY_STATES = [
  "RECEIVED",
  "CHANNEL_VERIFIED",
  "MERCHANT_RESOLUTION",
  "AMBIGUOUS",
  "NOT_FOUND",
  "ORDER_RESOLUTION",
  "MULTIPLE_MATCHES",
  "ORDER_NOT_FOUND",
  "CUSTOMER_VERIFICATION",
  "VERIFICATION_REQUIRED",
  "VERIFIED",
  "TICKET_CREATED",
] as const;

export type SupportIdentityState = (typeof SUPPORT_IDENTITY_STATES)[number];

export type IdentityEvidence = {
  token?: string | null;
  order_id?: string | null;
  organization_id?: string | null;
  hmac?: boolean;
  phone_match?: boolean;
  shop_domain?: string | null;
  reason?: string;
  conversation_id?: string | null;
  copied?: number;
};

export async function assertOrderInOrganization(
  supabase: SupabaseClient,
  organizationId: string,
  orderId: string
) {
  const { data } = await supabase
    .from("orders")
    .select("id, organization_id, customer_id, shipping_address_id, order_number, source_order_id")
    .eq("id", orderId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data?.id) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "That order does not belong to this workspace.");
  }
  return data;
}

export async function orderPhones(
  supabase: SupabaseClient,
  organizationId: string,
  order: { customer_id?: string | null; shipping_address_id?: string | null }
) {
  const phones: string[] = [];
  if (order.customer_id) {
    const { data } = await supabase
      .from("customers")
      .select("phone")
      .eq("id", order.customer_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    const digits = extractIndiaMobileDigits(data?.phone);
    if (digits) phones.push(digits);
  }
  if (order.shipping_address_id) {
    const { data } = await supabase
      .from("addresses")
      .select("phone")
      .eq("id", order.shipping_address_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    const digits = extractIndiaMobileDigits(data?.phone);
    if (digits) phones.push(digits);
  }
  return [...new Set(phones)];
}

export async function phoneMatchesOrder(
  supabase: SupabaseClient,
  organizationId: string,
  orderId: string,
  phone: string
) {
  const { data: order } = await supabase
    .from("orders")
    .select("id, organization_id, customer_id, shipping_address_id")
    .eq("id", orderId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!order?.id) return { ok: false as const, order: null, phones: [] as string[] };
  const sender = extractIndiaMobileDigits(phone);
  if (!sender) return { ok: false as const, order, phones: [] as string[] };
  const phones = await orderPhones(supabase, organizationId, order);
  return { ok: phones.includes(sender), order, phones };
}

export async function assertPhoneOnOrder(
  supabase: SupabaseClient,
  organizationId: string,
  orderId: string,
  phone: string
) {
  const result = await phoneMatchesOrder(supabase, organizationId, orderId, phone);
  if (!result.ok) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Customer WhatsApp number does not match that order.");
  }
  return result;
}

export async function recordIdentityResolution(
  supabase: SupabaseClient,
  input: {
    state: SupportIdentityState;
    phoneDigits?: string | null;
    organizationId?: string | null;
    orderId?: string | null;
    conversationId?: string | null;
    unassignedThreadId?: string | null;
    actorId?: string | null;
    evidence?: IdentityEvidence;
  }
) {
  await supabase.from("support_identity_resolutions").insert({
    state: input.state,
    phone_digits: input.phoneDigits ?? null,
    organization_id: input.organizationId ?? null,
    order_id: input.orderId ?? null,
    conversation_id: input.conversationId ?? null,
    unassigned_thread_id: input.unassignedThreadId ?? null,
    actor_id: input.actorId ?? null,
    evidence: input.evidence ?? {},
  });
}

export async function lookupOrdersByToken(supabase: SupabaseClient, token: string) {
  const stripped = token.replace(/^#/, "");
  const { data: byNumber } = await supabase
    .from("orders")
    .select("id, organization_id, order_number, source_order_id, customer_id, shipping_address_id")
    .or(`order_number.eq.${token},order_number.eq.${stripped},source_order_id.eq.${stripped},source_order_id.eq.${token}`)
    .limit(20);
  const { data: refs } = await supabase
    .from("external_order_references")
    .select("order_id, organization_id, source_order_id, shop_domain")
    .or(`source_order_id.eq.${stripped},source_order_id.eq.${token}`)
    .limit(20);
  const byId = new Map<string, { id: string; organization_id: string; shop_domain?: string | null }>();
  for (const row of byNumber ?? []) {
    byId.set(row.id, { id: row.id, organization_id: row.organization_id });
  }
  for (const row of refs ?? []) {
    const existing = byId.get(row.order_id);
    if (existing) {
      existing.shop_domain = row.shop_domain;
    } else {
      byId.set(row.order_id, {
        id: row.order_id,
        organization_id: row.organization_id,
        shop_domain: row.shop_domain,
      });
    }
  }
  return [...byId.values()];
}

export async function resolveInOrgOrderFromText(
  supabase: SupabaseClient,
  organizationId: string,
  phone: string,
  text: string,
  tokens: string[]
) {
  if (!tokens.length) return { orderId: null as string | null, state: "VERIFICATION_REQUIRED" as SupportIdentityState };
  const matches: string[] = [];
  for (const token of tokens) {
    const rows = await lookupOrdersByToken(supabase, token);
    for (const row of rows) {
      if (row.organization_id !== organizationId) continue;
      const check = await phoneMatchesOrder(supabase, organizationId, row.id, phone);
      if (check.ok && !matches.includes(row.id)) matches.push(row.id);
    }
  }
  if (matches.length === 1) return { orderId: matches[0], state: "VERIFIED" as const };
  if (matches.length > 1) return { orderId: null, state: "MULTIPLE_MATCHES" as const };
  return { orderId: null, state: "ORDER_NOT_FOUND" as const };
}
