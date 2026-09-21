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

export type IndiaPostOffice = {
  office_id?: string | number;
  office_name?: string;
  pincode?: string | number;
  office_type_code?: string;
  delivery_office_flag?: boolean;
  city_name?: string;
  state_name?: string;
};

export function indiaPostRequiredText(value: string | null | undefined, fallback: string) {
  const text = (value ?? "").trim();
  if (text.length >= 3) return text.slice(0, 80);
  const backup = fallback.trim();
  if (backup.length >= 3) return backup.slice(0, 80);
  return "India Post";
}

export function indiaPostFindOffice(offices: IndiaPostOffice[], officeId?: string | null) {
  if (!officeId) return null;
  return offices.find((office) => String(office.office_id) === String(officeId)) ?? null;
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

export function indiaPostTransmissionMode(serviceCode: string) {
  return indiaPostBookingArticleType(serviceCode) === "BP" ? "S" : "A";
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
  senderCity?: string | null;
  senderState?: string | null;
  senderPin?: string | null;
  deliveryOfficeName?: string | null;
  bookingOfficeName: string;
  bookingOfficePin: string;
}) {
  const physical = Math.max(1, Number(input.weightGrams) || 1);
  const volumetric = indiaPostVolumetricWeightGrams(input.lengthCm, input.widthCm, input.heightCm);
  const charged = Math.max(physical, volumetric || physical);
  const customerId = Number(input.customerId);
  const originPin = input.senderPin || input.bookingOfficePin;
  return {
    customer_id: customerId,
    delivery_office_name: input.deliveryOfficeName || undefined,
    destination_pin: input.recipientPin,
    booking_datetime: indiaPostLabelBookingDatetime(input.bookedAt),
    channel_type: "E",
    user_type: "R",
    user_id: customerId,
    barcode_no: input.barcode,
    service_type: indiaPostBookingArticleType(input.serviceCode),
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
    recipient_addressl1: input.recipientLine1,
    recipient_addressl2: input.recipientLine2 || "",
    recipient_addressl3: "",
    recipient_city: input.recipientCity,
    recipient_pin: input.recipientPin,
    recipient_state: input.recipientState,
    sender_name: input.senderName,
    sender_mobile: input.senderMobile || undefined,
    sender_addressl1: input.senderLine1 || "",
    sender_addressl2: "",
    sender_addressl3: "",
    sender_city: input.senderCity || "",
    sender_pin: originPin,
    sender_state: input.senderState || "",
    transmission_mode: indiaPostTransmissionMode(input.serviceCode),
    payment_mode: "CO",
    routing_data: `${input.bookingOfficePin} - ${input.recipientPin}`,
    booking_office_name: input.bookingOfficeName,
    booking_office_pin: input.bookingOfficePin,
    size: "A6",
    total_amount: Number(input.tariff) || 0,
    payment_status: "PC",
    value_added_services: "ND",
    identifier: "Domestic",
    bkg_ref_id: input.bkgRefId || "",
    priority: false,
    registered_flag: false,
  };
}

/** CEPT POST /process-articles/{customerId} article body. */
export function indiaPostBookingArticle(input: {
  customerId: string;
  contractId: string;
  barcode: string;
  officeId: string | number;
  originPin: string;
  serviceCode: string;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  senderName: string;
  senderCompany?: string | null;
  senderLine1: string;
  senderLine2?: string | null;
  senderCity: string;
  senderState: string;
  senderMobile: string;
  receiverName: string;
  receiverLine1: string;
  receiverLine2?: string | null;
  receiverCity: string;
  receiverState: string;
  receiverPin: string;
  receiverMobile: string;
}) {
  const officeId = Number(input.officeId);
  return {
    bulk_customer_id: input.customerId,
    contract_id: input.contractId,
    barcode_no: input.barcode,
    pickup_or_dropoff: "DROPOFF",
    pickup_dropoff_office_id: officeId,
    pickup_address_flag: "FALSE",
    article_type: indiaPostBookingArticleType(input.serviceCode),
    physical_weight: Math.max(1, Math.round(Number(input.weightGrams) || 1)),
    shape_of_article: indiaPostShapeOfArticle(input.serviceCode, input.weightGrams),
    length: Math.max(0, Number(input.lengthCm) || 0),
    breadth_diameter: Math.max(0, Number(input.widthCm) || 0),
    height: Math.max(0, Number(input.heightCm) || 0),
    sender_name: indiaPostRequiredText(input.senderName, "Merchant"),
    sender_company: indiaPostRequiredText(input.senderCompany, input.senderName || "Merchant"),
    sender_add_line_1: indiaPostRequiredText(input.senderLine1, "Registered pickup"),
    sender_add_line_2: input.senderLine2 && input.senderLine2.trim().length >= 3 ? input.senderLine2.trim().slice(0, 80) : undefined,
    sender_city: indiaPostRequiredText(input.senderCity, "Ernakulam"),
    sender_state: indiaPostRequiredText(input.senderState, "Kerala"),
    sender_pincode: input.originPin,
    sender_mobile_no: input.senderMobile,
    receiver_name: indiaPostRequiredText(input.receiverName, "Customer"),
    receiver_company: indiaPostRequiredText(input.receiverName, "Customer"),
    receiver_add_line_1: indiaPostRequiredText(input.receiverLine1, "Address"),
    receiver_add_line_2: input.receiverLine2 && input.receiverLine2.trim().length >= 3 ? input.receiverLine2.trim().slice(0, 80) : undefined,
    receiver_city: indiaPostRequiredText(input.receiverCity, "City"),
    receiver_state: indiaPostRequiredText(input.receiverState, "State"),
    receiver_pincode: input.receiverPin,
    drop_off_pincode: input.originPin,
    receiver_mobile_no: input.receiverMobile,
    alt_address_flag: "FALSE",
    ack: "FALSE",
    reg: "FALSE",
    otp: "FALSE",
  };
}
