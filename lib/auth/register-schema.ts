import { z } from "zod";
import { isIndiaWhatsappInput, toIndiaWhatsappE164 } from "@/lib/phone/india-whatsapp";

export const registerAccountSchema = z.object({
  name: z.string().trim().min(2, "Enter your name."),
  // Phone keyboards and autofill often leave a trailing space; Supabase stores emails lowercased.
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  // Supabase hashes with bcrypt, which ignores everything past 72 bytes.
  password: z.string().min(8, "Use at least 8 characters.").max(72, "Use 72 characters or fewer."),
  whatsapp: z
    .string()
    .trim()
    .refine(isIndiaWhatsappInput, "Enter a 10-digit Indian WhatsApp number.")
    .transform((value) => toIndiaWhatsappE164(value)),
  pincode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, "Enter a valid 6-digit PIN code."),
  city: z.string().trim().min(2, "Enter your city.").max(80, "Enter your city."),
});

export type RegisterAccountInput = z.input<typeof registerAccountSchema>;
export type RegisterAccountValues = z.output<typeof registerAccountSchema>;
