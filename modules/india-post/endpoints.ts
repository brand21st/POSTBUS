import { indiaPostBaseUrl } from "@/lib/env";
import type { ProviderEnvironment } from "@/types/domain";

/** CEPT login, tariff, pincode, label and tracking sit under /beextcustomer/v1. */
export function indiaPostOrigin(configured: string) {
  return configured.trim().replace(/\/+$/, "").replace(/\/beextcustomer(?:\/v1)?$/i, "");
}

export function indiaPostSessionOrigin(environment: ProviderEnvironment) {
  return indiaPostOrigin(indiaPostBaseUrl(environment));
}

export function indiaPostSessionUrl(environment: ProviderEnvironment, path: string) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${indiaPostSessionOrigin(environment)}/beextcustomer/v1${suffix}`;
}

/**
 * Booking is documented without /v1:
 * POST https://{host}/beextcustomer/process-articles/{customerId}
 * (UAT host test.cept.gov.in, production host app.indiapost.gov.in)
 */
export function indiaPostBookingUrl(environment: ProviderEnvironment, customerId: string) {
  return `${indiaPostSessionOrigin(environment)}/beextcustomer/process-articles/${encodeURIComponent(customerId)}`;
}

export function indiaPostBookingArticleType(serviceCode: string) {
  const code = serviceCode.trim().toUpperCase();
  if (code === "BP" || code === "BUSINESS_PARCEL") return "BP";
  if (code.startsWith("24_") || code.startsWith("48_")) return code;
  return "SP";
}

export function indiaPostShapeOfArticle(serviceCode: string, weightGrams: number) {
  const bookingType = indiaPostBookingArticleType(serviceCode);
  if (bookingType === "BP" || bookingType === "24_SPP_PARSPL" || serviceCode === "SP_INLAND_PARCEL") {
    return "NROL";
  }
  if (weightGrams >= 500 && bookingType === "SP") return "NROL";
  return "DOC";
}

export function indiaPostMobile(phone?: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const lastTen = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(lastTen) ? lastTen : null;
}
