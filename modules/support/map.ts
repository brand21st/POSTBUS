import type { SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from "@/types/domain";

export type SupportTicketRow = {
  id: string;
  organization_id: string;
  conversation_id: string;
  order_id: string | null;
  shipment_id: string | null;
  public_number: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  category: SupportTicketCategory;
  assigned_to: string | null;
  classification: string | null;
  sla_due_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
};

export function mapTicket(row: SupportTicketRow, extras?: Record<string, unknown>) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    orderId: row.order_id,
    shipmentId: row.shipment_id,
    publicNumber: row.public_number,
    status: row.status,
    priority: row.priority,
    category: row.category,
    assignedTo: row.assigned_to,
    classification: row.classification,
    slaDueAt: row.sla_due_at,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extras,
  };
}

export function mapConversation(row: {
  id: string;
  phone_digits: string;
  customer_name: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  last_customer_message_at: string | null;
  service_window_expires_at: string | null;
  unread_count: number;
  customer_id: string | null;
}) {
  return {
    id: row.id,
    phoneDigits: row.phone_digits,
    customerName: row.customer_name,
    lastMessagePreview: row.last_message_preview,
    lastMessageAt: row.last_message_at,
    lastCustomerMessageAt: row.last_customer_message_at,
    serviceWindowExpiresAt: row.service_window_expires_at,
    unreadCount: row.unread_count,
    customerId: row.customer_id,
    channelId: "channel_id" in row ? (row as { channel_id?: string }).channel_id : undefined,
  };
}

export function mapMessage(row: {
  id: string;
  conversation_id: string;
  ticket_id: string | null;
  direction: string;
  body: string | null;
  content_type: string;
  status: string;
  provider_timestamp: string | null;
  created_at: string;
  client_send_id: string | null;
}) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    ticketId: row.ticket_id,
    direction: row.direction,
    body: row.body,
    contentType: row.content_type,
    status: row.status,
    providerTimestamp: row.provider_timestamp,
    createdAt: row.created_at,
    clientSendId: row.client_send_id,
  };
}
