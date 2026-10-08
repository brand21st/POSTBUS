import { indiaPostBaseUrl } from "@/lib/env";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { indiaPostServiceForBarcodePrefix } from "@/modules/india-post/barcode";
import { assertIndiaPostEnvironmentUrl } from "@/modules/india-post/environment";
import { INDIA_POST_SPEED_POST_DOC_WEIGHT_MAX_G } from "@/modules/india-post/spec";
import { indiaPostServiceLabel, type ProviderEnvironment } from "@/types/domain";

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
  const url = `${apiRoot(environment)}/v1${suffix}`;
  assertIndiaPostEnvironmentUrl(environment, url);
  return url;
}

/** Documented CEPT lookup for post offices by 6-digit pincode (requires Bearer token). */
export function indiaPostPincodeSearchApiUrl(environment: ProviderEnvironment, pincode = "682311") {
  const params = new URLSearchParams({ pincode, "office-type": "post" });
  return `${indiaPostSessionUrl(environment, "/pincode-search")}?${params}`;
}

export function indiaPostBookingUrl(environment: ProviderEnvironment, customerId: string) {
  const url = `${apiRoot(environment)}/process-articles/${encodeURIComponent(customerId)}`;
  assertIndiaPostEnvironmentUrl(environment, url);
  return url;
}

export function indiaPostBookingFileUrl(environment: ProviderEnvironment, customerId: string) {
  const url = `${apiRoot(environment)}/process-articles-file/${encodeURIComponent(customerId)}`;
  assertIndiaPostEnvironmentUrl(environment, url);
  return url;
}

/**
 * CEPT process-articles `article_type`. The field table lists the product
 * codes India Post uses to pick the booked service:
 * SP_INLAND_PARCEL (Speed Post Parcel Domestic), BUSINESS_PARCEL, and the NDD
 * codes. A short "SP" books Inland Speed Post, so parcel bookings must send
 * the product code even when the article is under 500 g.
 *
 * Label `service_type` is SP for Speed Post and BUSINESS_PARCEL for
 * India Post Parcel Contractual. The short "BP" code prints REGISTERED BOOK POST
 * on CEPT's PDF. See `indiaPostLabelServiceType`.
 */
export function indiaPostBookingServiceCode(serviceCode: string, barcode?: string) {
  const fromPrefix = indiaPostServiceForBarcodePrefix(String(barcode ?? "").slice(0, 2));
  if (fromPrefix) return fromPrefix;
  const code = serviceCode.trim().toUpperCase();
  if (code === "BP") return "BUSINESS_PARCEL";
  return code;
}

export function indiaPostBookingArticleType(serviceCode: string, barcode?: string) {
  const code = indiaPostBookingServiceCode(serviceCode, barcode);
  if (code === "BP" || code === "BUSINESS_PARCEL") return "BUSINESS_PARCEL";
  if (code === "SP_INLAND_DOC") return "SP_INLAND_DOC";
  if (code.startsWith("24_") || code.startsWith("48_")) return code;
  return "SP_INLAND_PARCEL";
}

/** Domestic label API `service_type`. CEPT prints INDIAPOST PARCEL CONTRACTUAL only for BUSINESS_PARCEL. */
export function indiaPostLabelServiceType(serviceCode: string, barcode?: string) {
  const type = indiaPostBookingArticleType(serviceCode, barcode);
  if (type === "BP" || type === "BUSINESS_PARCEL") return "BUSINESS_PARCEL";
  if (type.startsWith("24_") || type.startsWith("48_")) return type;
  return "SP";
}

/** Printed under the barcode on the official CX / Business Parcel label. */
export const INDIA_POST_PARCEL_CONTRACTUAL_CAPTION = "INDIAPOST PARCEL CONTRACTUAL";

export function indiaPostLabelProductCaption(serviceCode: string, barcode?: string) {
  if (indiaPostLabelServiceType(serviceCode, barcode) === "BUSINESS_PARCEL") {
    return INDIA_POST_PARCEL_CONTRACTUAL_CAPTION;
  }
  return indiaPostServiceLabel(indiaPostBookingServiceCode(serviceCode, barcode) || serviceCode);
}

/**
 * Selected parcel products stay parcels at any legal weight (1 g–35 kg).
 * Weight is only a fallback when the caller sent a bare "SP" with no product.
 */
export function indiaPostSpeedPostKind(serviceCode: string, weightGrams: number, barcode?: string): "PARCEL" | "DOC" {
  const code = indiaPostBookingServiceCode(serviceCode, barcode);
  if (code === "SP_INLAND_PARCEL" || code === "BUSINESS_PARCEL" || code === "BP" || code === "24_SPP_PARSPL") {
    return "PARCEL";
  }
  if (code === "SP_INLAND_DOC" || code === "24_SPEEDPOST_DOC" || code === "48_SPEEDPOST_DOC") return "DOC";
  return weightGrams >= INDIA_POST_SPEED_POST_DOC_WEIGHT_MAX_G ? "PARCEL" : "DOC";
}

export function indiaPostShapeOfArticle(serviceCode: string, weightGrams: number, barcode?: string) {
  const bookingType = indiaPostBookingArticleType(serviceCode, barcode);
  if (bookingType === "BP" || bookingType === "BUSINESS_PARCEL" || bookingType === "24_SPP_PARSPL" || bookingType === "SP_INLAND_PARCEL") {
    return "NROL";
  }
  if (bookingType === "SP_INLAND_DOC" || bookingType === "24_SPEEDPOST_DOC" || bookingType === "48_SPEEDPOST_DOC") {
    return "DOC";
  }
  if (bookingType === "SP" && indiaPostSpeedPostKind(serviceCode, weightGrams) === "PARCEL") return "NROL";
  return "DOC";
}

export function indiaPostMobile(phone?: string | null) {
  return extractIndiaMobileDigits(phone);
}

export type IndiaPostOffice = {
  office_id?: string | number;
  office_name?: string;
  pincode?: string | number;
  office_type_code?: string;
  delivery_office_flag?: boolean;
  city_name?: string;
  state_name?: string;
  taluk_name?: string;
  village_name?: string;
  is_rolled_out?: boolean;
};

export function indiaPostDeliveryOfficeFlag(value: unknown) {
  if (value === true || value === 1) return true;
  const text = String(value ?? "").trim().toUpperCase();
  return text === "TRUE" || text === "1" || text === "Y" || text === "YES";
}

export function indiaPostIsEligibleBookingOffice(office: IndiaPostOffice) {
  const officeId = String(office.office_id ?? "").replace(/\D/g, "");
  if (officeId.length !== 8) return false;
  if (!String(office.office_name ?? "").trim()) return false;
  if (String(office.office_type_code ?? "").trim().toUpperCase() === "BPO") return false;
  return indiaPostDeliveryOfficeFlag(office.delivery_office_flag);
}

export function indiaPostOfficesForSelection(offices: IndiaPostOffice[]) {
  return offices.filter(indiaPostIsEligibleBookingOffice);
}

export function indiaPostNormalizeOffice(raw: unknown): IndiaPostOffice {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    office_id: row.office_id as string | number | undefined,
    office_name: row.office_name != null ? String(row.office_name) : undefined,
    pincode: row.pincode as string | number | undefined,
    office_type_code: row.office_type_code != null ? String(row.office_type_code) : undefined,
    delivery_office_flag: indiaPostDeliveryOfficeFlag(row.delivery_office_flag),
    city_name: row.city_name != null ? String(row.city_name) : undefined,
    state_name: row.state_name != null ? String(row.state_name) : undefined,
    taluk_name: row.taluk_name != null ? String(row.taluk_name) : undefined,
    village_name: row.village_name != null ? String(row.village_name) : undefined,
    is_rolled_out: indiaPostDeliveryOfficeFlag(row.is_rolled_out),
  };
}

export function indiaPostOfficeToApiRow(office: IndiaPostOffice, fallbackPin: string) {
  return {
    officeId: String(office.office_id ?? "").replace(/\D/g, "").slice(0, 8),
    name: office.office_name ?? "",
    pincode: String(office.pincode ?? fallbackPin),
    city: office.city_name ?? "",
    state: office.state_name ?? "",
    officeTypeCode: office.office_type_code ?? "",
    taluk: office.taluk_name ?? "",
    village: office.village_name ?? "",
    deliveryOfficeFlag: indiaPostDeliveryOfficeFlag(office.delivery_office_flag),
    isRolledOut: indiaPostDeliveryOfficeFlag(office.is_rolled_out),
  };
}

export function indiaPostRequiredText(value: string | null | undefined, fallback: string) {
  const text = (value ?? "").trim();
  if (text.length >= 3) return text.slice(0, 80);
  const backup = fallback.trim();
  if (backup.length >= 3) return backup.slice(0, 80);
  return "India Post";
}

export function indiaPostIsPrepaid(paymentMode?: string | null) {
  const mode = String(paymentMode ?? "").trim().toUpperCase();
  return mode !== "COD" && mode !== "CASH_ON_DELIVERY";
}

/** CEPT postage is CONTRACT (`CO`) or COD. Prepaid Shopify orders are CONTRACT; the PDF overlay prints "Prepaid". */
export function indiaPostLabelPaymentFields(paymentMode?: string | null, codAmount?: number | string | null) {
  const prepaid = indiaPostIsPrepaid(paymentMode);
  return {
    payment_mode: prepaid ? "CO" : "COD",
    payment_status: "PC" as const,
    payment_label: prepaid ? "Prepaid" : "COD",
    cod_value: prepaid ? 0 : Math.max(0, Number(codAmount) || 0),
  };
}

export function indiaPostLabelPartyLines(input: {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pin?: string | null;
  mobile?: string | null;
  paymentLabel?: string | null;
}) {
  const street = [input.line1, input.line2]
    .map((value) => (value ?? "").trim())
    .filter((value) => value.length > 0 && !/^registered\s*pickup$/i.test(value));
  const phone = input.mobile ? `Ph:${input.mobile}` : "";
  const pay = (input.paymentLabel ?? "").trim();
  const packed = [...street, phone, pay].filter(Boolean);
  return {
    addressl1: (packed[0] || (input.city ?? "").trim() || "Address").slice(0, 80),
    addressl2: packed.slice(1, 2).join(" ").slice(0, 80),
    addressl3: packed.slice(2).join(" ").slice(0, 80),
  };
}

export function indiaPostFindOffice(offices: IndiaPostOffice[], officeId?: string | null) {
  if (!officeId) return null;
  return offices.find((office) => String(office.office_id) === String(officeId)) ?? null;
}

export function indiaPostOfficesFromPincodeResponse(json: unknown): IndiaPostOffice[] {
  let rows: unknown[] = [];
  if (Array.isArray(json)) rows = json;
  else if (json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data)) {
    rows = (json as { data: unknown[] }).data;
  }
  return rows.map(indiaPostNormalizeOffice);
}

export function indiaPostPickDeliveryOffice(offices: IndiaPostOffice[]) {
  const list = offices.filter((office) => office?.office_name);
  return (
    list.find((office) => String(office.office_type_code).toUpperCase() === "HO") ||
    list.find((office) => String(office.office_type_code).toUpperCase() === "SPO") ||
    list.find((office) => office.delivery_office_flag) ||
    list[0] ||
    null
  );
}

export function indiaPostVolumetricWeightGrams(lengthCm: number, widthCm: number, heightCm: number) {
  if (lengthCm <= 0 || widthCm <= 0 || heightCm <= 0) return 0;
  return Math.ceil((lengthCm * widthCm * heightCm) / 5);
}

export function indiaPostTransmissionMode(serviceCode: string, barcode?: string) {
  const type = indiaPostBookingArticleType(serviceCode, barcode);
  return type === "BP" || type === "BUSINESS_PARCEL" ? "S" : "A";
}

export function indiaPostLabelBookingDatetime(value?: string | Date | null) {
  const date = value ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(safe)
      .map((part) => [part.type, part.value])
  );
  return `${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** CEPT POST /v1/label/create/domestic — body is an array of these objects. */
export function indiaPostDomesticLabelPayload(input: {
  customerId: string;
  barcode: string;
  serviceCode: string;
  bookedAt?: string | null;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  tariff?: number | string | null;
  bkgRefId?: string | null;
  recipientName: string;
  recipientMobile?: string | null;
  recipientLine1: string;
  recipientLine2?: string | null;
  recipientCity: string;
  recipientState: string;
  recipientPin: string;
  senderName: string;
  senderMobile?: string | null;
  senderLine1?: string | null;
  senderLine2?: string | null;
  senderCity?: string | null;
  senderState?: string | null;
  senderPin?: string | null;
  deliveryOfficeName?: string | null;
  bookingOfficeName: string;
  bookingOfficePin: string;
  paymentMode?: string | null;
  codAmount?: number | string | null;
}) {
  const physical = Math.max(1, Number(input.weightGrams) || 1);
  const volumetric = indiaPostVolumetricWeightGrams(input.lengthCm, input.widthCm, input.heightCm);
  const charged = Math.max(physical, volumetric || physical);
  const customerId = Number(input.customerId);
  const originPin = input.senderPin || input.bookingOfficePin;
  const payment = indiaPostLabelPaymentFields(input.paymentMode, input.codAmount);
  const receiverLines = indiaPostLabelPartyLines({
    line1: input.recipientLine1,
    line2: input.recipientLine2,
    city: input.recipientCity,
    state: input.recipientState,
    pin: input.recipientPin,
    mobile: input.recipientMobile,
    paymentLabel: payment.payment_label,
  });
  const senderLines = indiaPostLabelPartyLines({
    line1: input.senderLine1,
    line2: input.senderLine2,
    city: input.senderCity,
    state: input.senderState,
    pin: originPin,
    mobile: input.senderMobile,
  });
  return {
    customer_id: customerId,
    delivery_office_name: input.deliveryOfficeName || undefined,
    destination_pin: input.recipientPin,
    booking_datetime: indiaPostLabelBookingDatetime(input.bookedAt),
    channel_type: "E",
    user_type: "R",
    user_id: customerId,
    barcode_no: input.barcode,
    service_type: indiaPostLabelServiceType(input.serviceCode, input.barcode),
    booking_type: "COMMERCIAL",
    article_length: String(Math.max(0, Number(input.lengthCm) || 0)),
    article_breadth: String(Math.max(0, Number(input.widthCm) || 0)),
    article_height: String(Math.max(0, Number(input.heightCm) || 0)),
    charged_weight: charged,
    physical_weight: physical,
    volumetric_weight: volumetric,
    insurance_flag: false,
    insurance_value: 0,
    recipient_name: input.recipientName,
    recipient_mobile: input.recipientMobile || undefined,
    recipient_addressl1: receiverLines.addressl1,
    recipient_addressl2: receiverLines.addressl2,
    recipient_addressl3: receiverLines.addressl3,
    recipient_city: input.recipientCity,
    recipient_pin: input.recipientPin,
    recipient_state: input.recipientState,
    sender_name: input.senderName,
    sender_mobile: input.senderMobile || undefined,
    sender_addressl1: senderLines.addressl1,
    sender_addressl2: senderLines.addressl2,
    sender_addressl3: senderLines.addressl3,
    sender_city: input.senderCity || "",
    sender_pin: originPin,
    sender_state: input.senderState || "",
    transmission_mode: indiaPostTransmissionMode(input.serviceCode, input.barcode),
    payment_mode: payment.payment_mode,
    routing_data: `${input.bookingOfficePin} - ${input.recipientPin}`,
    booking_office_name: input.bookingOfficeName,
    booking_office_pin: input.bookingOfficePin,
    size: "A6",
    total_amount: Number(input.tariff) || 0,
    payment_status: payment.payment_status,
    cod_value: payment.cod_value,
    value_added_services: "ND",
    identifier: "Domestic",
    bkg_ref_id: input.bkgRefId || "",
    priority: false,
    registered_flag: false,
  };
}

export { indiaPostBookingArticle } from "@/modules/india-post/booking-payload";
