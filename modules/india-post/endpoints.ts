import { indiaPostBaseUrl } from "@/lib/env";
import type { ProviderEnvironment } from "@/types/domain";

/**
 * India Post CEPT root: https://{host}/beextcustomer
 *
 * Login (and other session APIs) use /v1 under this root.
 * Booking does not: POST {root}/process-articles/{customerId}
 *
 * Accepts a host, a /beextcustomer root, or a /beextcustomer/v1 session URL
 * so Coolify can keep INDIA_POST_PROD_BASE_URL ending in /v1 without
 * putting /v1 on the booking path.
 */
export function indiaPostApiRoot(configured: string) {
  let url = configured.trim().replace(/\/+$/, "");
  url = url.replace(/\/v1$/i, "");
  if (!/\/beextcustomer$/i.test(url)) {
    url = `${url}/beextcustomer`;
  }
  return url;
}

function apiRoot(environment: ProviderEnvironment) {
  return indiaPostApiRoot(indiaPostBaseUrl(environment));
}

export function indiaPostSessionUrl(environment: ProviderEnvironment, path: string) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${apiRoot(environment)}/v1${suffix}`;
}

export function indiaPostBookingUrl(environment: ProviderEnvironment, customerId: string) {
  return `${apiRoot(environment)}/process-articles/${encodeURIComponent(customerId)}`;
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
