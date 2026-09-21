import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "" ? null : value));

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "" ? null : value))
    .refine(
      (value) =>
        value == null || /^(\+91[\s-]?)?[6-9]\d{9}$/.test(value.replace(/\s/g, "")),
      { message: "Enter a 10-digit Indian mobile number." }
    ),
  line1: optionalText(160),
  line2: optionalText(160),
  city: optionalText(80),
  state: optionalText(80),
  pincode: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "" ? null : value))
    .refine((value) => value == null || /^\d{6}$/.test(value), {
      message: "Pincode must be 6 digits.",
    }),
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
