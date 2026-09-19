import { z } from "zod";
import { isIndiaWhatsappInput, toIndiaWhatsappE164 } from "@/lib/phone/india-whatsapp";

export const registerAccountSchema = z.object({
  name: z.string().trim().min(2, "Enter your name."),
  email: z.email("Enter a valid email."),
  password: z.string().min(8, "Use at least 8 characters."),
  whatsapp: z
    .string()
    .trim()
    .refine(isIndiaWhatsappInput, "Enter a 10-digit Indian WhatsApp number.")
    .transform((value) => toIndiaWhatsappE164(value)),
});

export type RegisterAccountInput = z.input<typeof registerAccountSchema>;
export type RegisterAccountValues = z.output<typeof registerAccountSchema>;
