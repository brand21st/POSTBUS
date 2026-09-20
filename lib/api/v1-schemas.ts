import { z } from "zod";

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  currency: z.string().trim().min(3).max(8).optional(),
});

export const switchOrganizationSchema = z.object({
  organizationId: z.string().uuid(),
});

export const memberInviteSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["OWNER", "ADMIN", "MANAGER", "OPERATOR", "VIEWER"]).default("OPERATOR"),
});

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
});

export const createWebhookEndpointSchema = z.object({
  url: z.string().trim().url(),
  events: z.array(z.string().min(1)).optional(),
});
