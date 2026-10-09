import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { hasPermission } from "@/lib/permissions/rbac";
import type { MemberRole, SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from "@/types/domain";
import { assertTicketTransition, canApprovePostbusCancellation, OPEN_TICKET_STATUSES } from "@/modules/support/states";
import { assertWorkflowTransition } from "@/modules/support/states";
import { mapTicket, type SupportTicketRow } from "@/modules/support/map";
import { classifySupportIntent } from "@/modules/support/intent";
import { assertOrderInOrganization } from "@/modules/support/identity";

const TICKET_SELECT =
  "id, organization_id, conversation_id, order_id, shipment_id, public_number, status, priority, category, assigned_to, classification, sla_due_at, resolved_at, closed_at, resolution_note, created_at, updated_at";

async function insertEvent(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    ticketId: string;
    actorId?: string | null;
    kind: string;
    fromValue?: string | null;
    toValue?: string | null;
    payload?: Record<string, unknown>;
  }
) {
  await supabase.from("support_ticket_events").insert({
    organization_id: input.organizationId,
    ticket_id: input.ticketId,
    actor_id: input.actorId ?? null,
    kind: input.kind,
    from_value: input.fromValue ?? null,
    to_value: input.toValue ?? null,
    payload: input.payload ?? {},
  });
}

export async function allocateTicketNumber(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase.rpc("next_support_ticket_number", {
    p_organization_id: organizationId,
  });
  if (error || !data) {
    throw new AppError(ERROR_CODES.JOB_FAILED, error?.message || "Could not allocate a ticket number.");
  }
  return String(data);
}

export async function findOpenTicket(
  supabase: SupabaseClient,
  organizationId: string,
  conversationId: string
) {
  const { data } = await supabase
    .from("support_tickets")
    .select(TICKET_SELECT)
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .in("status", OPEN_TICKET_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SupportTicketRow | null) ?? null;
}

export async function createTicket(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    conversationId: string;
    actorId?: string | null;
    category?: SupportTicketCategory;
    priority?: SupportTicketPriority;
    orderId?: string | null;
    text?: string;
  }
) {
  const intent = classifySupportIntent(input.text ?? "");
  const orderId = input.orderId ?? null;
  if (orderId) {
    await assertOrderInOrganization(supabase, input.organizationId, orderId);
  }
  const category = input.category ?? (orderId ? intent.category : "general_inquiry");
  const publicNumber = await allocateTicketNumber(supabase, input.organizationId);
  const { data, error } = await supabase
    .from("support_tickets")
    .insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      public_number: publicNumber,
      status: "open",
      priority: input.priority ?? "normal",
      category,
      order_id: orderId,
      classification: input.text ? intent.category : null,
    })
    .select(TICKET_SELECT)
    .single();
  if (error || !data) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not create ticket.");
  }
  const ticket = data as SupportTicketRow;
  await insertEvent(supabase, {
    organizationId: input.organizationId,
    ticketId: ticket.id,
    actorId: input.actorId,
    kind: "created",
    toValue: ticket.status,
    payload: { category, publicNumber },
  });
  const workflowKind = !orderId
    ? null
    : category === "order_cancellation"
      ? "cancellation"
      : category === "product_return"
        ? "return"
        : category === "product_exchange"
          ? "exchange"
          : intent.workflowKind;
  if (workflowKind) {
    await supabase.from("support_workflows").insert({
      organization_id: input.organizationId,
      ticket_id: ticket.id,
      kind: workflowKind,
      status: "requested",
    });
  }
  await supabase.from("notifications").insert({
    organization_id: input.organizationId,
    type: "support.ticket_created",
    title: "New support ticket",
    body: publicNumber,
    entity_type: "support_ticket",
    entity_id: ticket.id,
  });
  await supabase.from("audit_logs").insert({
    organization_id: input.organizationId,
    actor_id: input.actorId ?? null,
    action: "support.ticket.created",
    entity_type: "support_ticket",
    entity_id: ticket.id,
    after: { publicNumber, category },
  });
  return ticket;
}

export async function attachOrCreateTicket(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    conversationId: string;
    text?: string;
    orderId?: string | null;
  }
) {
  const open = await findOpenTicket(supabase, input.organizationId, input.conversationId);
  if (open) {
    if (input.orderId && !open.order_id) {
      await assertOrderInOrganization(supabase, input.organizationId, input.orderId);
      await supabase
        .from("support_tickets")
        .update({ order_id: input.orderId })
        .eq("id", open.id)
        .eq("organization_id", input.organizationId);
      return { ticket: { ...open, order_id: input.orderId }, created: false };
    }
    return { ticket: open, created: false };
  }
  const ticket = await createTicket(supabase, input);
  return { ticket, created: true };
}

export async function getTicket(
  supabase: SupabaseClient,
  organizationId: string,
  ticketId: string
) {
  const { data, error } = await supabase
    .from("support_tickets")
    .select(TICKET_SELECT)
    .eq("organization_id", organizationId)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Ticket not found.");
  return data as SupportTicketRow;
}

export async function listTickets(
  supabase: SupabaseClient,
  organizationId: string,
  query: {
    cursor?: string;
    q?: string;
    status?: SupportTicketStatus;
    priority?: SupportTicketPriority;
    category?: SupportTicketCategory;
    assigned?: "me" | "unassigned" | "all";
    conversationId?: string;
    userId?: string;
    limit?: number;
  }
) {
  const limit = query.limit ?? 40;
  let request = supabase
    .from("support_tickets")
    .select(TICKET_SELECT, { count: "exact" })
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (query.status) request = request.eq("status", query.status);
  if (query.priority) request = request.eq("priority", query.priority);
  if (query.category) request = request.eq("category", query.category);
  if (query.conversationId) request = request.eq("conversation_id", query.conversationId);
  if (query.assigned === "unassigned") request = request.is("assigned_to", null);
  if (query.assigned === "me" && query.userId) request = request.eq("assigned_to", query.userId);
  if (query.q) request = request.ilike("public_number", `%${query.q}%`);
  if (query.cursor) request = request.lt("updated_at", query.cursor);
  const { data, count, error } = await request;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const items = (data ?? []) as SupportTicketRow[];
  return {
    items: items.map((row) => mapTicket(row)),
    nextCursor: items.length === limit ? items[items.length - 1]?.updated_at : null,
    total: count ?? items.length,
  };
}

export async function patchTicket(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    ticketId: string;
    actorId: string;
    role: MemberRole;
    status?: SupportTicketStatus;
    priority?: SupportTicketPriority;
    category?: SupportTicketCategory;
    orderId?: string | null;
    resolutionNote?: string;
  }
) {
  const current = await getTicket(supabase, input.organizationId, input.ticketId);
  const updates: Record<string, unknown> = {};
  if (input.status && input.status !== current.status) {
    if (!hasPermission(input.role, "support.manage")) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "You cannot change ticket status.");
    }
    assertTicketTransition(current.status, input.status);
    if (input.status === "resolved" && !input.resolutionNote && !current.resolution_note) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Add a resolution note before resolving.");
    }
    updates.status = input.status;
    if (input.status === "resolved") updates.resolved_at = new Date().toISOString();
    if (input.status === "closed") updates.closed_at = new Date().toISOString();
    if (input.status === "reopened") {
      updates.resolved_at = null;
      updates.closed_at = null;
    }
  }
  if (input.priority && input.priority !== current.priority) updates.priority = input.priority;
  if (input.category && input.category !== current.category) updates.category = input.category;
  if (input.orderId !== undefined) {
    if (input.orderId) {
      await assertOrderInOrganization(supabase, input.organizationId, input.orderId);
    }
    updates.order_id = input.orderId;
  }
  if (input.resolutionNote) updates.resolution_note = input.resolutionNote;
  if (!Object.keys(updates).length) return mapTicket(current);

  const { data, error } = await supabase
    .from("support_tickets")
    .update(updates)
    .eq("id", current.id)
    .eq("organization_id", input.organizationId)
    .select(TICKET_SELECT)
    .single();
  if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Update failed.");
  const next = data as SupportTicketRow;
  if (input.status && input.status !== current.status) {
    await insertEvent(supabase, {
      organizationId: input.organizationId,
      ticketId: current.id,
      actorId: input.actorId,
      kind: "status",
      fromValue: current.status,
      toValue: input.status,
    });
  }
  if (input.priority && input.priority !== current.priority) {
    await insertEvent(supabase, {
      organizationId: input.organizationId,
      ticketId: current.id,
      actorId: input.actorId,
      kind: "priority",
      fromValue: current.priority,
      toValue: input.priority,
    });
  }
  await supabase.from("audit_logs").insert({
    organization_id: input.organizationId,
    actor_id: input.actorId,
    action: "support.ticket.updated",
    entity_type: "support_ticket",
    entity_id: current.id,
    before: { status: current.status, priority: current.priority },
    after: updates,
  });
  return mapTicket(next);
}

export async function assignTicket(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    ticketId: string;
    actorId: string;
    assignedTo: string | null;
  }
) {
  const current = await getTicket(supabase, input.organizationId, input.ticketId);
  const { data, error } = await supabase
    .from("support_tickets")
    .update({ assigned_to: input.assignedTo })
    .eq("id", current.id)
    .eq("organization_id", input.organizationId)
    .select(TICKET_SELECT)
    .single();
  if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Assign failed.");
  await insertEvent(supabase, {
    organizationId: input.organizationId,
    ticketId: current.id,
    actorId: input.actorId,
    kind: "assignment",
    fromValue: current.assigned_to,
    toValue: input.assignedTo,
  });
  if (input.assignedTo) {
    await supabase.from("notifications").insert({
      organization_id: input.organizationId,
      user_id: input.assignedTo,
      type: "support.ticket_assigned",
      title: "Ticket assigned",
      body: current.public_number,
      entity_type: "support_ticket",
      entity_id: current.id,
    });
  }
  return mapTicket(data as SupportTicketRow);
}

export async function addTicketNote(
  supabase: SupabaseClient,
  input: { organizationId: string; ticketId: string; actorId: string; body: string }
) {
  await getTicket(supabase, input.organizationId, input.ticketId);
  const { data, error } = await supabase
    .from("support_ticket_notes")
    .insert({
      organization_id: input.organizationId,
      ticket_id: input.ticketId,
      author_id: input.actorId,
      body: input.body,
    })
    .select("id, body, author_id, created_at")
    .single();
  if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Note failed.");
  await insertEvent(supabase, {
    organizationId: input.organizationId,
    ticketId: input.ticketId,
    actorId: input.actorId,
    kind: "note",
    payload: { noteId: data.id },
  });
  return data;
}

export async function listTicketTimeline(
  supabase: SupabaseClient,
  organizationId: string,
  ticketId: string
) {
  await getTicket(supabase, organizationId, ticketId);
  const [{ data: events }, { data: notes }, { data: workflow }] = await Promise.all([
    supabase
      .from("support_ticket_events")
      .select("id, kind, from_value, to_value, payload, actor_id, created_at")
      .eq("organization_id", organizationId)
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true }),
    supabase
      .from("support_ticket_notes")
      .select("id, body, author_id, created_at")
      .eq("organization_id", organizationId)
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true }),
    supabase
      .from("support_workflows")
      .select("id, kind, status, updated_at")
      .eq("organization_id", organizationId)
      .eq("ticket_id", ticketId)
      .maybeSingle(),
  ]);
  return { events: events ?? [], notes: notes ?? [], workflow: workflow ?? null };
}

export async function patchWorkflow(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    ticketId: string;
    actorId: string;
    status: string;
  }
) {
  const ticket = await getTicket(supabase, input.organizationId, input.ticketId);
  const { data: workflow } = await supabase
    .from("support_workflows")
    .select("id, kind, status")
    .eq("organization_id", input.organizationId)
    .eq("ticket_id", ticket.id)
    .maybeSingle();
  if (!workflow) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "No request workflow on this ticket.");
  assertWorkflowTransition(workflow.kind as "cancellation" | "return" | "exchange", workflow.status, input.status);

  if (workflow.kind === "cancellation" && input.status === "approved") {
    if (!ticket.order_id) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Link an order before approving cancellation.");
    }
    const { data: order } = await supabase
      .from("orders")
      .select("id, status")
      .eq("id", ticket.order_id)
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    const { data: shipments } = await supabase
      .from("shipments")
      .select("id, status")
      .eq("order_id", ticket.order_id)
      .eq("organization_id", input.organizationId);
    const booked = (shipments ?? []).some((row) =>
      ["BOOKED", "LABEL_READY", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "NDR", "RTO"].includes(row.status)
    );
    if (!canApprovePostbusCancellation(order?.status, booked)) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        "This order is already in fulfillment. Reject the request or ask for more information. Shopify is not cancelled automatically."
      );
    }
    await supabase
      .from("orders")
      .update({ status: "CANCELLED" })
      .eq("id", ticket.order_id)
      .eq("organization_id", input.organizationId);
    await supabase.from("audit_logs").insert({
      organization_id: input.organizationId,
      actor_id: input.actorId,
      action: "support.cancellation.approved",
      entity_type: "order",
      entity_id: ticket.order_id,
      after: { status: "CANCELLED", ticketId: ticket.id },
    });
  }

  const { data, error } = await supabase
    .from("support_workflows")
    .update({ status: input.status })
    .eq("id", workflow.id)
    .eq("organization_id", input.organizationId)
    .select("id, kind, status, updated_at")
    .single();
  if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Workflow update failed.");
  await insertEvent(supabase, {
    organizationId: input.organizationId,
    ticketId: ticket.id,
    actorId: input.actorId,
    kind: "workflow",
    fromValue: workflow.status,
    toValue: input.status,
    payload: { workflowKind: workflow.kind },
  });
  return data;
}
