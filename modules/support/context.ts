import type { SupabaseClient } from "@supabase/supabase-js";
import { getConversation } from "@/modules/support/conversations";
import { findOpenTicket, getTicket, listTicketTimeline } from "@/modules/support/tickets";
import { mapConversation, mapTicket } from "@/modules/support/map";
import { matchOrdersInOrganization } from "@/modules/support/matching";
import { isServiceWindowOpen, remainingWindowMs } from "@/modules/support/window";

export async function loadConversationContext(
  supabase: SupabaseClient,
  organizationId: string,
  conversationId: string
) {
  const conversation = await getConversation(supabase, organizationId, conversationId);
  const open = await findOpenTicket(supabase, organizationId, conversationId);
  const ticket = open;
  const timeline = ticket ? await listTicketTimeline(supabase, organizationId, ticket.id) : { events: [], notes: [], workflow: null };
  const matches = await matchOrdersInOrganization(supabase, organizationId, conversation.phone_digits);
  let order: Record<string, unknown> | null = null;
  let shipment: Record<string, unknown> | null = null;
  const orderId = ticket?.order_id ?? (matches.length === 1 ? matches[0].id : null);
  if (orderId) {
    const { data } = await supabase
      .from("orders")
      .select(
        "id, order_number, status, payment_status, fulfillment_status, total_amount, created_at, customers(name, phone), order_line_items(id, title, quantity, image_url)"
      )
      .eq("id", orderId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    order = data ?? null;
    const { data: shipments } = await supabase
      .from("shipments")
      .select("id, tracking_number, barcode, status, booked_at, delivered_at")
      .eq("order_id", orderId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(1);
    shipment = shipments?.[0] ?? null;
    if (shipment?.id) {
      const { data: events } = await supabase
        .from("tracking_events")
        .select("event_description, office_name, occurred_at")
        .eq("shipment_id", shipment.id)
        .order("occurred_at", { ascending: false })
        .limit(8);
      shipment = { ...shipment, events: events ?? [] };
    }
  }
  return {
    conversation: {
      ...mapConversation(conversation),
      windowOpen: isServiceWindowOpen(conversation.service_window_expires_at),
      windowRemainingMs: remainingWindowMs(conversation.service_window_expires_at),
    },
    ticket: ticket ? mapTicket(ticket) : null,
    timeline,
    order,
    shipment,
    orderMatches: matches,
  };
}

export async function loadTicketDetail(
  supabase: SupabaseClient,
  organizationId: string,
  ticketId: string
) {
  const ticket = await getTicket(supabase, organizationId, ticketId);
  const context = await loadConversationContext(supabase, organizationId, ticket.conversation_id);
  return { ...context, ticket: mapTicket(ticket) };
}
