import type { SupabaseClient } from "@supabase/supabase-js";
import { attachOrCreateTicket } from "@/modules/support/tickets";
import { ensureSupportChannel, upsertConversation } from "@/modules/support/conversations";

type QueuedMessage = {
  id: string;
  provider_message_id: string | null;
  body: string | null;
  content_type: string | null;
  created_at: string;
  provider_media_id?: string | null;
  source_url?: string | null;
};

export async function ingestAssignedUnassignedThread(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    orderId: string;
    phoneDigits: string;
    providerConversationId?: string | null;
    threadId: string;
    actorId?: string | null;
  }
) {
  const channelId = await ensureSupportChannel(supabase, input.organizationId, "postbus_global");
  const conversation = await upsertConversation(supabase, {
    organizationId: input.organizationId,
    channelId,
    phoneDigits: input.phoneDigits,
    providerConversationId: input.providerConversationId ?? null,
  });
  const { data: queued } = await supabase
    .from("support_unassigned_messages")
    .select("id, provider_message_id, body, content_type, created_at")
    .eq("thread_id", input.threadId)
    .order("created_at", { ascending: true });
  const rows = (queued ?? []) as QueuedMessage[];
  let copied = 0;
  let skipped = 0;
  let lastPreview = conversation.last_message_preview as string | null;
  let lastAt = conversation.last_message_at as string | null;
  for (const row of rows) {
    const providerMessageId = row.provider_message_id || `unassigned:${row.id}`;
    const { data: inserted, error } = await supabase
      .from("support_messages")
      .insert({
        organization_id: input.organizationId,
        conversation_id: conversation.id,
        direction: "inbound",
        body: row.body,
        content_type: row.content_type || "text",
        status: "received",
        provider_message_id: providerMessageId,
        provider_timestamp: row.created_at,
        created_at: row.created_at,
      })
      .select("id")
      .maybeSingle();
    if (error?.code === "23505") {
      skipped += 1;
      continue;
    }
    if (error || !inserted?.id) continue;
    copied += 1;
    lastPreview = (row.body || "Message").slice(0, 180);
    lastAt = row.created_at;
    const mediaId = row.provider_media_id;
    const sourceUrl = row.source_url;
    if (mediaId || sourceUrl) {
      await supabase.from("support_message_attachments").insert({
        organization_id: input.organizationId,
        message_id: inserted.id,
        provider_media_id: mediaId || null,
        source_url: sourceUrl || null,
        mime_type: row.content_type || null,
      });
    }
  }
  const ticket = await attachOrCreateTicket(supabase, {
    organizationId: input.organizationId,
    conversationId: conversation.id,
    text: lastPreview || "",
    orderId: input.orderId,
  });
  if (lastAt) {
    await supabase
      .from("support_conversations")
      .update({
        last_message_preview: lastPreview,
        last_message_at: lastAt,
        last_customer_message_at: lastAt,
        unread_count: Number(conversation.unread_count || 0) + copied,
      })
      .eq("id", conversation.id)
      .eq("organization_id", input.organizationId);
  }
  await supabase.from("notifications").insert({
    organization_id: input.organizationId,
    type: "support.conversation_assigned",
    title: "Support conversation assigned",
    body: lastPreview || "A Super Admin assigned a WhatsApp thread to this workspace.",
    entity_type: "support_conversation",
    entity_id: conversation.id,
  });
  return {
    conversationId: conversation.id as string,
    ticketId: ticket.ticket.id as string,
    copied,
    skipped,
  };
}
