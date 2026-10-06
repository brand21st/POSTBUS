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

export const registerPrinterSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((value) => value.replace(/[\u0000-\u001f]/g, ""))
    .refine((value) => value.trim().length > 0, { message: "Enter a printer name." }),
  deviceKey: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i, "Invalid printer.")
    .transform((value) => value.toLowerCase()),
  protocol: z.literal("tspl"),
});

export const printerPresenceSchema = z.object({
  state: z.enum(["connected", "disconnected"]),
});

export const printerEventSchema = z.object({
  event: z.enum(["test_requested", "test_succeeded", "test_failed"]),
});

export const completeWebusbJobSchema = z.object({
  status: z.enum(["PRINTED", "FAILED", "PENDING"]),
  errorMessage: z.string().trim().max(200).optional(),
});

const policyKeywordsSchema = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .transform((value) => (value === undefined ? undefined : value));

const policyBodySchema = z.string().max(8000).optional();

export const updateOrganizationPoliciesSchema = z.object({
  shippingPolicyBody: policyBodySchema,
  contactBody: policyBodySchema,
  returnsBody: policyBodySchema,
  termsBody: policyBodySchema,
  shippingPolicyKeywords: policyKeywordsSchema,
  contactKeywords: policyKeywordsSchema,
  returnsKeywords: policyKeywordsSchema,
  termsKeywords: policyKeywordsSchema,
  shippingPolicyEnabled: z.boolean().optional(),
  contactEnabled: z.boolean().optional(),
  returnsEnabled: z.boolean().optional(),
  termsEnabled: z.boolean().optional(),
});
