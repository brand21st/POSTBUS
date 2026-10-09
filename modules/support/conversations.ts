import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { mapConversation, mapMessage } from "@/modules/support/map";
import { sanitizeSupportSearch } from "@/modules/support/search";
import { OPEN_TICKET_STATUSES } from "@/modules/support/states";
import { isServiceWindowOpen } from "@/modules/support/window";

export async function ensureSupportChannel(
  supabase: SupabaseClient,
  organizationId: string,
  kind: "postbus_global" | "merchant_vachat" = "postbus_global",
  vachatConnectionId?: string | null
) {
  const { data: existing } = await supabase
    .from("support_channels")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("kind", kind)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data, error } = await supabase
    .from("support_channels")
    .insert({
      organization_id: organizationId,
      kind,
      vachat_connection_id: kind === "merchant_vachat" ? vachatConnectionId ?? null : null,
      provider: "vachat",
    })
    .select("id")
    .single();
  if (error || !data) {
    const { data: race } = await supabase
      .from("support_channels")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("kind", kind)
      .maybeSingle();
    if (race?.id) return race.id as string;
    throw new AppError(ERROR_CODES.JOB_FAILED, error?.message || "Could not create support channel.");
  }
  return data.id as string;
}

export async function upsertConversation(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    channelId: string;
    phoneDigits: string;
    providerConversationId?: string | null;
    customerName?: string | null;
  }
) {
  const phone = extractIndiaMobileDigits(input.phoneDigits);
  if (!phone) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Customer phone is missing.");
  }
  const { data: existing } = input.providerConversationId
    ? await supabase
        .from("support_conversations")
        .select("*")
        .eq("organization_id", input.organizationId)
        .eq("channel_id", input.channelId)
        .eq("provider_conversation_id", input.providerConversationId)
        .maybeSingle()
    : await supabase
        .from("support_conversations")
        .select("*")
        .eq("organization_id", input.organizationId)
        .eq("channel_id", input.channelId)
        .eq("phone_digits", phone)
        .maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabase
    .from("support_conversations")
    .insert({
      organization_id: input.organizationId,
      channel_id: input.channelId,
      phone_digits: phone,
      provider_conversation_id: input.providerConversationId ?? null,
      customer_name: input.customerName ?? null,
    })
    .select("*")
    .single();
  if (error) {
    const { data: raced } = await supabase
      .from("support_conversations")
      .select("*")
      .eq("organization_id", input.organizationId)
      .eq("channel_id", input.channelId)
      .eq("phone_digits", phone)
      .maybeSingle();
    if (raced) return raced;
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }
  return data;
}

export async function getConversation(
  supabase: SupabaseClient,
  organizationId: string,
  conversationId: string
) {
  const { data, error } = await supabase
    .from("support_conversations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Conversation not found.");
  return data;
}

async function conversationIdsMatchingSearch(
  supabase: SupabaseClient,
  organizationId: string,
  needle: string
) {
  const ids = new Set<string>();
  const { data: tickets } = await supabase
    .from("support_tickets")
    .select("conversation_id, order_id")
    .eq("organization_id", organizationId)
    .ilike("public_number", `%${needle}%`);
  for (const row of tickets ?? []) {
    if (row.conversation_id) ids.add(String(row.conversation_id));
  }
  const { data: orders } = await supabase
    .from("orders")
    .select("id")
    .eq("organization_id", organizationId)
    .ilike("order_number", `%${needle}%`)
    .limit(20);
  const orderIds = (orders ?? []).map((row) => String(row.id)).filter(Boolean);
  if (orderIds.length) {
    const { data: byOrder } = await supabase
      .from("support_tickets")
      .select("conversation_id")
      .eq("organization_id", organizationId)
      .in("order_id", orderIds);
    for (const row of byOrder ?? []) {
      if (row.conversation_id) ids.add(String(row.conversation_id));
    }
  }
  return [...ids];
}

export async function listConversations(
  supabase: SupabaseClient,
  organizationId: string,
  query: {
    cursor?: string;
    q?: string;
    filter?: string;
    category?: string;
    userId?: string;
    limit?: number;
  }
) {
  const limit = query.limit ?? 40;
  const needle = sanitizeSupportSearch(query.q);
  const extraIds = needle ? await conversationIdsMatchingSearch(supabase, organizationId, needle) : [];
  let request = supabase
    .from("support_conversations")
    .select("*")
    .eq("organization_id", organizationId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (needle) {
    const idClause = extraIds.length ? `,id.in.(${extraIds.join(",")})` : "";
    request = request.or(`customer_name.ilike.%${needle}%,phone_digits.ilike.%${needle}%${idClause}`);
  }
  if (query.filter === "unread") request = request.gt("unread_count", 0);
  if (query.cursor) request = request.lt("last_message_at", query.cursor);
  const { data, error } = await request;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const rows = data ?? [];
  const ids = rows.map((row) => row.id);
  type TicketSummary = {
    id: string;
    conversation_id: string;
    status: string;
    priority: string;
    category: string;
    assigned_to: string | null;
    public_number: string;
  };
  const { data: tickets } = ids.length
    ? await supabase
        .from("support_tickets")
        .select("id, conversation_id, status, priority, category, assigned_to, public_number")
        .eq("organization_id", organizationId)
        .in("conversation_id", ids)
        .order("updated_at", { ascending: false })
    : { data: [] as TicketSummary[] };
  const latestByConversation = new Map<string, TicketSummary>();
  for (const ticket of tickets ?? []) {
    if (!latestByConversation.has(ticket.conversation_id)) {
      latestByConversation.set(ticket.conversation_id, ticket);
    }
  }
  const filtered = rows.filter((row) => {
    const ticket = latestByConversation.get(row.id);
    if (query.category && ticket?.category !== query.category) return false;
    if (query.filter === "open") return ticket ? OPEN_TICKET_STATUSES.includes(ticket.status as never) : false;
    if (query.filter === "pending") {
      return ticket?.status === "pending_customer" || ticket?.status === "pending_merchant";
    }
    if (query.filter === "resolved") return ticket?.status === "resolved";
    if (query.filter === "closed") return ticket?.status === "closed";
    if (query.filter === "unassigned") return Boolean(ticket) && !ticket?.assigned_to;
    if (query.filter === "mine") return ticket?.assigned_to === query.userId;
    return true;
  });
  const channelIds = [...new Set(filtered.map((row) => String(row.channel_id ?? "")))].filter(Boolean);
  const { data: channels } = channelIds.length
    ? await supabase.from("support_channels").select("id, kind").in("id", channelIds)
    : { data: [] as Array<{ id: string; kind: string }> };
  const kindByChannel = new Map((channels ?? []).map((row) => [row.id, row.kind]));
  return {
    items: filtered.map((row) => ({
      ...mapConversation(row),
      channelKind: kindByChannel.get(row.channel_id) ?? "postbus_global",
      ticket: latestByConversation.get(row.id) ?? null,
      windowOpen: isServiceWindowOpen(row.service_window_expires_at),
    })),
    nextCursor: rows.length === limit ? rows[rows.length - 1]?.last_message_at : null,
  };
}

export async function listMessages(
  supabase: SupabaseClient,
  organizationId: string,
  conversationId: string,
  query: { cursor?: string; limit?: number }
) {
  await getConversation(supabase, organizationId, conversationId);
  const limit = query.limit ?? 50;
  let request = supabase
    .from("support_messages")
    .select("id, conversation_id, ticket_id, direction, body, content_type, status, provider_timestamp, created_at, client_send_id")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (query.cursor) request = request.lt("created_at", query.cursor);
  const { data, error } = await request;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const items = (data ?? []).map(mapMessage).reverse();
  return {
    items,
    nextCursor: data && data.length === limit ? data[data.length - 1]?.created_at : null,
  };
}

export async function markConversationRead(
  supabase: SupabaseClient,
  organizationId: string,
  conversationId: string
) {
  await supabase
    .from("support_conversations")
    .update({ unread_count: 0 })
    .eq("organization_id", organizationId)
    .eq("id", conversationId);
  return { ok: true };
}

export async function unreadConversationCount(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("support_conversations")
    .select("unread_count")
    .eq("organization_id", organizationId)
    .gt("unread_count", 0);
  return (data ?? []).reduce((sum, row) => sum + Number(row.unread_count || 0), 0);
}
