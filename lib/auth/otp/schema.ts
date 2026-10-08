import { z } from "zod";
import { toIndiaWhatsappE164 } from "@/lib/phone/india-whatsapp";

const phoneSchema = z.string().trim().transform((value, ctx) => {
  try {
    return toIndiaWhatsappE164(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "Enter a 10-digit Indian WhatsApp number." });
    return z.NEVER;
  }
});

const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  business_name: z.string().trim().min(2, "Enter your business name.").max(120),
  email: z.email("Enter a valid email.").transform((value) => value.trim().toLowerCase()),
});

export const otpRequestSchema = z.discriminatedUnion("purpose", [
  z.object({
    purpose: z.literal("LOGIN"),
    phone: phoneSchema,
  }),
  z.object({
    purpose: z.literal("SIGNUP"),
    phone: phoneSchema,
    name: z.string().trim().min(2, "Enter your name.").max(80),
    business_name: z.string().trim().min(2, "Enter your business name.").max(120),
    email: z.email("Enter a valid email.").transform((value) => value.trim().toLowerCase()),
  }),
]);

export const otpVerifySchema = z
  .object({
    challenge_id: z.uuid(),
    phone: phoneSchema,
    purpose: z.enum(["LOGIN", "SIGNUP"]),
    otp: z.string().regex(/^\d{6}$/, "Enter the 6-digit code.").optional(),
    profile: profileSchema.optional(),
  })
  .refine((value) => Boolean(value.otp) || Boolean(value.profile), {
    message: "Enter the 6-digit code.",
  });

export function signupFromRequest(value: z.infer<typeof otpRequestSchema>) {
  if (value.purpose !== "SIGNUP") return null;
  return {
    name: value.name,
    businessName: value.business_name,
    email: value.email,
  };
}

export function signupFromProfile(profile?: z.infer<typeof profileSchema> | null) {
  if (!profile) return null;
  return {
    name: profile.name,
    businessName: profile.business_name,
    email: profile.email,
  };
}
