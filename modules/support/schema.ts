import { z } from "zod";
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
} from "@/types/domain";

export const ticketListQuery = z.object({
  cursor: z.string().optional(),
  q: z.string().optional(),
  status: z.enum(SUPPORT_TICKET_STATUSES).optional(),
  priority: z.enum(SUPPORT_TICKET_PRIORITIES).optional(),
  category: z.enum(SUPPORT_TICKET_CATEGORIES).optional(),
  assigned: z.enum(["me", "unassigned", "all"]).optional(),
  conversationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const createTicketSchema = z.object({
  conversationId: z.string().uuid(),
  category: z.enum(SUPPORT_TICKET_CATEGORIES).optional(),
  priority: z.enum(SUPPORT_TICKET_PRIORITIES).optional(),
  orderId: z.string().uuid().nullable().optional(),
});

export const patchTicketSchema = z.object({
  status: z.enum(SUPPORT_TICKET_STATUSES).optional(),
  priority: z.enum(SUPPORT_TICKET_PRIORITIES).optional(),
  category: z.enum(SUPPORT_TICKET_CATEGORIES).optional(),
  orderId: z.string().uuid().nullable().optional(),
  resolutionNote: z.string().max(4000).optional(),
});

export const assignTicketSchema = z.object({
  assignedTo: z.string().uuid().nullable(),
});

export const ticketNoteSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export const patchWorkflowSchema = z.object({
  status: z.string().trim().min(1).max(64),
});

export const conversationListQuery = z.object({
  cursor: z.string().optional(),
  q: z.string().optional(),
  filter: z
    .enum(["all", "unread", "open", "pending", "resolved", "closed", "unassigned", "mine"])
    .optional(),
  category: z.enum(SUPPORT_TICKET_CATEGORIES).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const messageListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const sendMessageSchema = z.object({
  clientSendId: z.string().uuid(),
  text: z.string().trim().min(1).max(4096),
});

export const sendTemplateSchema = z.object({
  clientSendId: z.string().uuid(),
  templateName: z.string().trim().min(1).max(200),
  language: z.string().trim().min(2).max(16).optional(),
  variables: z.array(z.string().max(1024)).max(10).optional(),
});

export const patchSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(["postbus_global", "merchant_vachat"]).optional(),
  })
  .refine((body) => body.enabled !== undefined || body.mode !== undefined, {
    message: "enabled or mode is required.",
  });
