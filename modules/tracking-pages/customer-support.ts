import { digitsOnly, extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import type { TrackingPageRecord } from "@/types/api";

export function merchantSupportHref(page: Pick<TrackingPageRecord, "whatsapp" | "phone" | "email" | "social">) {
  if (page.whatsapp) {
    const national = extractIndiaMobileDigits(page.whatsapp);
    const digits = national ? `91${national}` : digitsOnly(page.whatsapp);
    if (digits) return `https://wa.me/${digits}`;
  }
  if (page.phone) return `tel:${page.phone}`;
  if (page.email) return `mailto:${page.email}`;
  return page.social.website ?? null;
}
