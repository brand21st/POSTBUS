import type { SupabaseClient } from "@supabase/supabase-js";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { ingestAssignedUnassignedThread } from "@/modules/support/assign-ingest";
import { parseEligibleChoiceRef } from "@/modules/vachat/eligible-orders";
import { supportInboxAvailable } from "@/modules/support/provider";
import {
  phoneMatchesOrder,
  lookupOrdersByToken,
  recordIdentityResolution,
  resolveInOrgOrderFromText,
  type IdentityEvidence,
  type SupportIdentityState,
} from "@/modules/support/identity";

export const SUPPORT_GLOBAL_BIND_MS = 30 * 24 * 60 * 60 * 1000;

export type GlobalIdentifyResult =
  | { kind: "assigned"; organizationId: string; orderId: string; state: "VERIFIED" }
  | { kind: "unassigned"; state: SupportIdentityState; evidence?: IdentityEvidence };

const PB_ORDER = /\b(PB-\d{4,})\b/i;
const HASH_ORDER = /#\s?(\d{3,})/;

export function orderTokensFromText(text: string) {
  const tokens: string[] = [];
  const pb = text.match(PB_ORDER);
  if (pb?.[1]) tokens.push(pb[1].toUpperCase());
  const hashed = text.match(HASH_ORDER);
  if (hashed?.[1]) {
    tokens.push(`#${hashed[1]}`);
    tokens.push(hashed[1]);
  }
  return [...new Set(tokens)];
}

export async function upsertGlobalBind(
  supabase: SupabaseClient,
  input: { phoneDigits: string; organizationId: string; orderId: string }
) {
  const phone = extractIndiaMobileDigits(input.phoneDigits);
  if (!phone) return;
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + SUPPORT_GLOBAL_BIND_MS).toISOString();
  await supabase.from("support_global_binds").upsert(
    {
      phone_digits: phone,
      organization_id: input.organizationId,
      order_id: input.orderId,
      verified_at: now,
      last_revalidated_at: now,
      expires_at: expires,
    },
    { onConflict: "phone_digits" }
  );
}

async function expireBind(supabase: SupabaseClient, phoneDigits: string) {
  await supabase
    .from("support_global_binds")
    .update({ expires_at: new Date(0).toISOString() })
    .eq("phone_digits", phoneDigits);
}

async function orgEligibleForGlobalSupport(supabase: SupabaseClient, organizationId: string) {
  const { data: org } = await supabase
    .from("organizations")
    .select("support_center_enabled, support_whatsapp_mode")
    .eq("id", organizationId)
    .maybeSingle();
  if (!org?.support_center_enabled) return false;
  if ((org.support_whatsapp_mode ?? "postbus_global") !== "postbus_global") return false;
  return supportInboxAvailable(supabase, organizationId);
}

export async function identifyGlobalInbound(
  supabase: SupabaseClient,
  input: { phone: string; text: string; buttonId?: string }
): Promise<GlobalIdentifyResult> {
  const phone = extractIndiaMobileDigits(input.phone);
  if (!phone) return { kind: "unassigned", state: "NOT_FOUND" };

  const choice = parseEligibleChoiceRef(input.buttonId || input.text.trim());
  if (choice && choice.phone_digits === phone) {
    const live = await phoneMatchesOrder(supabase, choice.organization_id, choice.order_id, phone);
    if (live.ok && (await orgEligibleForGlobalSupport(supabase, choice.organization_id))) {
      await upsertGlobalBind(supabase, {
        phoneDigits: phone,
        organizationId: choice.organization_id,
        orderId: choice.order_id,
      });
      await recordIdentityResolution(supabase, {
        state: "VERIFIED",
        phoneDigits: phone,
        organizationId: choice.organization_id,
        orderId: choice.order_id,
        evidence: { hmac: true, phone_match: true, order_id: choice.order_id, organization_id: choice.organization_id },
      });
      return { kind: "assigned", organizationId: choice.organization_id, orderId: choice.order_id, state: "VERIFIED" };
    }
  }

  const { data: bind } = await supabase
    .from("support_global_binds")
    .select("organization_id, order_id, expires_at")
    .eq("phone_digits", phone)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (bind?.organization_id) {
    if (!bind.order_id) {
      await expireBind(supabase, phone);
    } else {
      const live = await phoneMatchesOrder(supabase, bind.organization_id, bind.order_id, phone);
      if (live.ok && (await orgEligibleForGlobalSupport(supabase, bind.organization_id))) {
        await upsertGlobalBind(supabase, {
          phoneDigits: phone,
          organizationId: bind.organization_id,
          orderId: bind.order_id,
        });
        return { kind: "assigned", organizationId: bind.organization_id, orderId: bind.order_id, state: "VERIFIED" };
      }
      await expireBind(supabase, phone);
    }
  }

  const tokens = orderTokensFromText(input.text);
  if (!tokens.length) {
    return { kind: "unassigned", state: "VERIFICATION_REQUIRED", evidence: { reason: "no_order_token" } };
  }

  const matches: Array<{ id: string; organization_id: string; shop_domain?: string | null; token: string }> = [];
  for (const token of tokens) {
    const rows = await lookupOrdersByToken(supabase, token);
    for (const row of rows) {
      if (!matches.some((item) => item.id === row.id)) {
        matches.push({ ...row, token });
      }
    }
  }
  if (!matches.length) {
    return { kind: "unassigned", state: "ORDER_NOT_FOUND", evidence: { token: tokens[0] } };
  }
  const orgIds = [...new Set(matches.map((row) => row.organization_id))];
  if (orgIds.length !== 1) {
    return {
      kind: "unassigned",
      state: "MULTIPLE_MATCHES",
      evidence: { token: tokens[0], reason: "duplicate_order_number_across_orgs" },
    };
  }
  if (!(await orgEligibleForGlobalSupport(supabase, orgIds[0]))) {
    return { kind: "unassigned", state: "NOT_FOUND", evidence: { organization_id: orgIds[0] } };
  }

  const confirmed: typeof matches = [];
  for (const row of matches) {
    const live = await phoneMatchesOrder(supabase, row.organization_id, row.id, phone);
    if (live.ok) confirmed.push(row);
  }
  if (confirmed.length !== 1) {
    return {
      kind: "unassigned",
      state: confirmed.length ? "MULTIPLE_MATCHES" : "VERIFICATION_REQUIRED",
      evidence: { token: tokens[0], organization_id: orgIds[0], phone_match: false },
    };
  }

  await upsertGlobalBind(supabase, {
    phoneDigits: phone,
    organizationId: confirmed[0].organization_id,
    orderId: confirmed[0].id,
  });
  await recordIdentityResolution(supabase, {
    state: "VERIFIED",
    phoneDigits: phone,
    organizationId: confirmed[0].organization_id,
    orderId: confirmed[0].id,
    evidence: {
      token: confirmed[0].token,
      order_id: confirmed[0].id,
      organization_id: confirmed[0].organization_id,
      phone_match: true,
      shop_domain: confirmed[0].shop_domain ?? null,
    },
  });
  return {
    kind: "assigned",
    organizationId: confirmed[0].organization_id,
    orderId: confirmed[0].id,
    state: "VERIFIED",
  };
}

export async function quarantineInbound(
  supabase: SupabaseClient,
  input: {
    phone: string;
    text: string;
    conversationId?: string;
    providerMessageId?: string;
    state?: SupportIdentityState;
    evidence?: IdentityEvidence;
  }
) {
  const phone = extractIndiaMobileDigits(input.phone);
  if (!phone) return;
  const state = input.state ?? "VERIFICATION_REQUIRED";
  const { data: existing } = await supabase
    .from("support_unassigned_threads")
    .select("id")
    .eq("phone_digits", phone)
    .eq("status", "open")
    .maybeSingle();
  let threadId = existing?.id as string | undefined;
  if (!threadId) {
    const { data } = await supabase
      .from("support_unassigned_threads")
      .insert({
        phone_digits: phone,
        provider_conversation_id: input.conversationId ?? null,
        last_message_preview: input.text.slice(0, 180),
        last_message_at: new Date().toISOString(),
        status: "open",
        resolution_state: state,
        evidence: input.evidence ?? {},
      })
      .select("id")
      .single();
    threadId = data?.id;
  } else {
    await supabase
      .from("support_unassigned_threads")
      .update({
        last_message_preview: input.text.slice(0, 180),
        last_message_at: new Date().toISOString(),
        resolution_state: state,
        evidence: input.evidence ?? {},
      })
      .eq("id", threadId);
  }
  if (!threadId) return;
  await supabase.from("support_unassigned_messages").insert({
    thread_id: threadId,
    provider_message_id: input.providerMessageId || null,
    body: input.text,
  });
  await recordIdentityResolution(supabase, {
    state,
    phoneDigits: phone,
    unassignedThreadId: threadId,
    evidence: input.evidence,
  });
}

export async function listUnassignedThreads(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("support_unassigned_threads")
    .select("id, phone_digits, last_message_preview, last_message_at, status, resolution_state, created_at")
    .eq("status", "open")
    .order("last_message_at", { ascending: false })
    .limit(50);
  const items = data ?? [];
  const counts: Record<string, number> = {};
  for (const row of items) {
    const key = String(row.resolution_state || "VERIFICATION_REQUIRED");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return { items, counts, count: items.length };
}

export async function assignUnassignedThread(
  supabase: SupabaseClient,
  input: { threadId: string; orderId: string; actorId?: string | null }
) {
  const { data: order } = await supabase
    .from("orders")
    .select("id, organization_id")
    .eq("id", input.orderId)
    .maybeSingle();
  if (!order?.organization_id) {
    return { ok: false as const, error: "Order not found." };
  }
  if (!(await orgEligibleForGlobalSupport(supabase, order.organization_id))) {
    return { ok: false as const, error: "That merchant is not using PostBus WhatsApp support." };
  }
  const { data: thread } = await supabase
    .from("support_unassigned_threads")
    .select("id, phone_digits, status, assigned_organization_id, provider_conversation_id")
    .eq("id", input.threadId)
    .maybeSingle();
  if (!thread) return { ok: false as const, error: "Thread not found." };
  if (thread.status === "assigned" && thread.assigned_organization_id && thread.assigned_organization_id !== order.organization_id) {
    return { ok: false as const, error: "This thread is already assigned to another merchant." };
  }
  const live = await phoneMatchesOrder(supabase, order.organization_id, order.id, thread.phone_digits);
  if (!live.ok) {
    return { ok: false as const, error: "The WhatsApp number on this thread does not match that order." };
  }
  await upsertGlobalBind(supabase, {
    phoneDigits: thread.phone_digits,
    organizationId: order.organization_id,
    orderId: order.id,
  });
  const ingested = await ingestAssignedUnassignedThread(supabase, {
    organizationId: order.organization_id,
    orderId: order.id,
    phoneDigits: thread.phone_digits,
    providerConversationId: thread.provider_conversation_id,
    threadId: thread.id,
    actorId: input.actorId,
  });
  await supabase
    .from("support_unassigned_threads")
    .update({
      status: "assigned",
      resolution_state: "VERIFIED",
      assigned_organization_id: order.organization_id,
      evidence: { order_id: order.id, organization_id: order.organization_id, phone_match: true },
    })
    .eq("id", thread.id);
  await recordIdentityResolution(supabase, {
    state: "VERIFIED",
    phoneDigits: thread.phone_digits,
    organizationId: order.organization_id,
    orderId: order.id,
    unassignedThreadId: thread.id,
    actorId: input.actorId,
    evidence: {
      order_id: order.id,
      organization_id: order.organization_id,
      phone_match: true,
      reason: "manual_assign",
      conversation_id: ingested.conversationId,
      copied: ingested.copied,
    },
  });
  return {
    ok: true as const,
    organizationId: order.organization_id,
    orderId: order.id,
    phoneDigits: thread.phone_digits,
    conversationId: ingested.conversationId,
    copied: ingested.copied,
    skipped: ingested.skipped,
  };
}

export { resolveInOrgOrderFromText };
