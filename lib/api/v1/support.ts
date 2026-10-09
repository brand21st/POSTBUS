import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { hasPermission } from "@/lib/permissions/rbac";
import {
  assignTicketSchema,
  conversationListQuery,
  createTicketSchema,
  messageListQuery,
  patchSettingsSchema,
  patchTicketSchema,
  patchWorkflowSchema,
  sendMessageSchema,
  sendTemplateSchema,
  ticketListQuery,
  ticketNoteSchema,
} from "@/modules/support/schema";
import { assertSupportCanEnable, assertSupportCenterEnabled, loadSupportSettings } from "@/modules/support/flag";
import { isSupportWhatsAppMode } from "@/modules/support/provider";
import {
  addTicketNote,
  assignTicket,
  createTicket,
  listTickets,
  patchTicket,
  patchWorkflow,
} from "@/modules/support/tickets";
import {
  getConversation,
  listConversations,
  listMessages,
  markConversationRead,
  unreadConversationCount,
} from "@/modules/support/conversations";
import { loadConversationContext, loadTicketDetail } from "@/modules/support/context";
import { listApprovedSupportTemplates, sendSupportTemplate, sendSupportText } from "@/modules/support/send";
import { matchOrdersInOrganization } from "@/modules/support/matching";

export async function handleSupportRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  method: string,
  slugs: string[]
) {
  if (slugs[0] !== "support") return null;
  const rest = slugs.slice(1);

  if (method === "GET" && rest[0] === "settings" && rest.length === 1) {
    return loadSupportSettings(supabase, ctx.organizationId);
  }

  if (method === "PATCH" && rest[0] === "settings" && rest.length === 1) {
    const body = patchSettingsSchema.parse(await request.json().catch(() => ({})));
    const current = await loadSupportSettings(supabase, ctx.organizationId);
    const nextMode = isSupportWhatsAppMode(body.mode) ? body.mode : current.mode;
    if (body.mode && body.mode !== current.mode && ctx.role !== "OWNER") {
      throw new AppError(ERROR_CODES.FORBIDDEN, "Only the workspace owner can switch the WhatsApp number.");
    }
    const nextEnabled = body.enabled ?? current.flagged;
    if (nextEnabled) assertSupportCanEnable(current, nextMode);
    const patch: Record<string, unknown> = {};
    if (body.enabled !== undefined) patch.support_center_enabled = body.enabled;
    if (body.mode && body.mode !== current.mode) patch.support_whatsapp_mode = body.mode;
    if (Object.keys(patch).length) {
      await supabase.from("organizations").update(patch).eq("id", ctx.organizationId);
    }
    const audits: string[] = [];
    if (body.enabled !== undefined && body.enabled !== current.flagged) {
      audits.push(body.enabled ? "support.center.enabled" : "support.center.disabled");
    }
    if (body.mode && body.mode !== current.mode) audits.push("support.whatsapp_mode.changed");
    for (const action of audits) {
      await supabase.from("audit_logs").insert({
        organization_id: ctx.organizationId,
        actor_id: ctx.userId,
        action,
        entity_type: "organization",
        entity_id: ctx.organizationId,
        after: { mode: nextMode },
      });
    }
    return loadSupportSettings(supabase, ctx.organizationId);
  }

  if (method === "GET" && rest[0] === "unread" && rest.length === 1) {
    const settings = await loadSupportSettings(supabase, ctx.organizationId);
    if (!settings.enabled) return { count: 0 };
    return { count: await unreadConversationCount(supabase, ctx.organizationId) };
  }

  await assertSupportCenterEnabled(supabase, ctx.organizationId);

  if (method === "GET" && rest[0] === "conversations" && rest.length === 1) {
    const query = conversationListQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
    return listConversations(supabase, ctx.organizationId, { ...query, userId: ctx.userId });
  }

  if (method === "GET" && rest[0] === "conversations" && rest[2] === "messages") {
    const query = messageListQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
    return listMessages(supabase, ctx.organizationId, rest[1], query);
  }

  if (method === "GET" && rest[0] === "conversations" && rest[2] === "context") {
    return loadConversationContext(supabase, ctx.organizationId, rest[1]);
  }

  if (method === "POST" && rest[0] === "conversations" && rest[2] === "read") {
    return markConversationRead(supabase, ctx.organizationId, rest[1]);
  }

  if (method === "POST" && rest[0] === "conversations" && rest[2] === "messages") {
    const body = sendMessageSchema.parse(await request.json().catch(() => ({})));
    return sendSupportText(supabase, {
      organizationId: ctx.organizationId,
      conversationId: rest[1],
      actorId: ctx.userId,
      clientSendId: body.clientSendId,
      text: body.text,
    });
  }

  if (method === "POST" && rest[0] === "conversations" && rest[2] === "templates") {
    const body = sendTemplateSchema.parse(await request.json().catch(() => ({})));
    return sendSupportTemplate(supabase, {
      organizationId: ctx.organizationId,
      conversationId: rest[1],
      actorId: ctx.userId,
      clientSendId: body.clientSendId,
      templateName: body.templateName,
      language: body.language,
      variables: body.variables,
    });
  }

  if (method === "GET" && rest[0] === "templates" && rest.length === 1) {
    return { items: await listApprovedSupportTemplates(supabase, ctx.organizationId) };
  }

  if (method === "GET" && rest[0] === "tickets" && rest.length === 1) {
    const query = ticketListQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
    return listTickets(supabase, ctx.organizationId, { ...query, userId: ctx.userId });
  }

  if (method === "POST" && rest[0] === "tickets" && rest.length === 1) {
    const body = createTicketSchema.parse(await request.json().catch(() => ({})));
    await getConversation(supabase, ctx.organizationId, body.conversationId);
    const ticket = await createTicket(supabase, {
      organizationId: ctx.organizationId,
      conversationId: body.conversationId,
      actorId: ctx.userId,
      category: body.category,
      priority: body.priority,
      orderId: body.orderId,
    });
    return ticket;
  }

  if (method === "GET" && rest[0] === "tickets" && rest[1] && rest.length === 2) {
    return loadTicketDetail(supabase, ctx.organizationId, rest[1]);
  }

  if (method === "PATCH" && rest[0] === "tickets" && rest[1] && rest.length === 2) {
    const body = patchTicketSchema.parse(await request.json().catch(() => ({})));
    return patchTicket(supabase, {
      organizationId: ctx.organizationId,
      ticketId: rest[1],
      actorId: ctx.userId,
      role: ctx.role,
      ...body,
    });
  }

  if (method === "POST" && rest[0] === "tickets" && rest[2] === "assign") {
    const body = assignTicketSchema.parse(await request.json().catch(() => ({})));
    return assignTicket(supabase, {
      organizationId: ctx.organizationId,
      ticketId: rest[1],
      actorId: ctx.userId,
      assignedTo: body.assignedTo,
    });
  }

  if (method === "POST" && rest[0] === "tickets" && rest[2] === "notes") {
    const body = ticketNoteSchema.parse(await request.json().catch(() => ({})));
    return addTicketNote(supabase, {
      organizationId: ctx.organizationId,
      ticketId: rest[1],
      actorId: ctx.userId,
      body: body.body,
    });
  }

  if (method === "PATCH" && rest[0] === "tickets" && rest[2] === "workflow") {
    if (!hasPermission(ctx.role, "support.manage")) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "You cannot update request workflows.");
    }
    const body = patchWorkflowSchema.parse(await request.json().catch(() => ({})));
    return patchWorkflow(supabase, {
      organizationId: ctx.organizationId,
      ticketId: rest[1],
      actorId: ctx.userId,
      status: body.status,
    });
  }

  if (method === "GET" && rest[0] === "orders" && rest[1] === "match") {
    const conversationId = request.nextUrl.searchParams.get("conversationId") || "";
    const conversation = await getConversation(supabase, ctx.organizationId, conversationId);
    return { items: await matchOrdersInOrganization(supabase, ctx.organizationId, conversation.phone_digits) };
  }

  return null;
}
