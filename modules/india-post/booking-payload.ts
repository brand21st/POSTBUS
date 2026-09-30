import { CEPT_BOOKING_FIELD_NAMES } from "@/modules/india-post/article-fields";
import type { ValidatedArticle } from "@/modules/india-post/article-types";
import {
  indiaPostBookingArticleType,
  indiaPostRequiredText,
  indiaPostShapeOfArticle,
} from "@/modules/india-post/endpoints";
import { INDIA_POST_ADDRESS_LINE_MAX, INDIA_POST_BULK_REFERENCE_MAX, indiaPostRequiresOtp } from "@/modules/india-post/spec";

function empty(value?: string | number | null) {
  if (value == null) return "";
  return String(value);
}

function flag(value?: boolean | string | null, fallback = "FALSE") {
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  const text = String(value ?? "").trim().toUpperCase();
  if (text === "TRUE" || text === "1") return "TRUE";
  if (text === "FALSE" || text === "0") return "FALSE";
  return fallback;
}

function optionalText(value?: string | null) {
  const text = (value ?? "").trim();
  if (text.length < 3) return "";
  return text.slice(0, INDIA_POST_ADDRESS_LINE_MAX);
}

/** Serializes a validated article into the documented CEPT process-articles object. */
export function serializeIndiaPostBookingArticle(article: ValidatedArticle) {
  const pickup = article.pickupOrDropoff === "PICKUP";
  const alt = article.altAddressEnabled;
  const payload: Record<string, string | number> = {
    bulk_customer_id: article.customerId,
    contract_id: article.contractId,
    barcode_no: article.barcode,
    pickup_or_dropoff: article.pickupOrDropoff,
    pickup_dropoff_office_id: Number(article.officeId),
    article_type: indiaPostBookingArticleType(article.serviceCode),
    physical_weight: Math.round(article.weightGrams),
    shape_of_article: (article.shape || indiaPostShapeOfArticle(article.serviceCode, article.weightGrams)).toUpperCase(),
    length: article.lengthCm,
    breadth_diameter: article.widthCm,
    height: article.heightCm,
    priority_flag: article.priorityFlag || "",
    delivery_instruction: article.deliveryInstruction || "",
    delivery_slot: article.deliverySlot || "",
    instruction_rts: article.instructionRts || "",
    sender_name: article.sender.name.slice(0, INDIA_POST_ADDRESS_LINE_MAX),
    sender_company: article.sender.company.slice(0, INDIA_POST_ADDRESS_LINE_MAX),
    sender_add_line_1: article.sender.line1.slice(0, INDIA_POST_ADDRESS_LINE_MAX),
    sender_add_line_2: optionalText(article.sender.line2),
    sender_add_line_3: optionalText(article.sender.line3),
    sender_city: article.sender.city.slice(0, INDIA_POST_ADDRESS_LINE_MAX),
    sender_state: optionalText(article.sender.state),
    sender_pincode: article.sender.pincode,
    sender_emailid: optionalText(article.sender.email),
    sender_alt_contact: article.sender.altContact || "",
    sender_kyc: article.sender.kyc || "",
    sender_tax_reference: article.sender.taxReference || "",
    receiver_name: article.receiver.name.slice(0, INDIA_POST_ADDRESS_LINE_MAX),
    receiver_company: article.receiver.company.slice(0, INDIA_POST_ADDRESS_LINE_MAX),
    receiver_add_line_1: article.receiver.line1.slice(0, INDIA_POST_ADDRESS_LINE_MAX),
    receiver_add_line_2: optionalText(article.receiver.line2),
    receiver_add_line_3: optionalText(article.receiver.line3),
    receiver_city: article.receiver.city.slice(0, INDIA_POST_ADDRESS_LINE_MAX),
    receiver_state: optionalText(article.receiver.state),
    receiver_pincode: article.receiver.pincode,
    receiver_emailid: optionalText(article.receiver.email),
    receiver_alt_contact: article.receiver.altContact || "",
    receiver_kyc: article.receiver.kyc || "",
    receiver_tax_reference: article.receiver.taxReference || "",
    alt_address_flag: alt ? "TRUE" : "FALSE",
    pickup_address_flag: pickup ? "TRUE" : "FALSE",
    drop_off_pincode: pickup ? "" : article.originPin,
    sender_mobile_no: article.sender.mobile,
    receiver_mobile_no: article.receiver.mobile,
    prepayment_code: article.prepaymentCode || "",
    value_of_prepayment: article.prepaymentCode ? Number(article.prepaymentValue) || 0 : 0,
    codr_cod: article.paymentMode === "COD" ? article.codKind || "COD" : "",
    value_for_codr_cod: article.paymentMode === "COD" ? article.codAmount : "",
    insurance_type: article.insuranceType === "DOP" ? "DOP" : "",
    value_of_insurance: article.insuranceType === "DOP" ? Number(article.insuranceValue) || 0 : 0,
    ack: flag(article.ack, "FALSE"),
    reg: flag(article.reg, "FALSE"),
    otp: indiaPostRequiresOtp(article.serviceCode) ? "TRUE" : "FALSE",
    bulk_reference: (article.bulkReference || "").slice(0, INDIA_POST_BULK_REFERENCE_MAX),
    pickup_address_id: pickup ? empty(article.pickup?.addressId) : "",
    pickup_addressee_name: pickup ? article.pickup?.addresseeName ?? "" : "",
    pickup_company_name: pickup ? article.pickup?.companyName ?? "" : "",
    pickup_address_line1: pickup ? article.pickup?.line1 ?? "" : "",
    pickup_address_line2: pickup ? optionalText(article.pickup?.line2) : "",
    pickup_address_line3: pickup ? optionalText(article.pickup?.line3) : "",
    pickup_city: pickup ? article.pickup?.city ?? "" : "",
    pickup_state: pickup ? optionalText(article.pickup?.state) : "",
    pickup_pincode: pickup ? article.pickup?.pincode ?? "" : "",
    pickup_email_id: pickup ? optionalText(article.pickup?.email) : "",
    pickup_alt_contact_no: pickup ? article.pickup?.altContact || "" : "",
    pickup_mobile_no: pickup ? article.pickup?.mobile ?? "" : "",
    pickup_schedule_slot: pickup ? article.pickup?.scheduleSlot ?? "" : "",
    pickup_schedule_date: pickup ? article.pickup?.scheduleDate ?? "" : "",
    alt_addressee_name: alt ? article.alt?.addresseeName ?? "" : "",
    alt_company_name: alt ? article.alt?.companyName ?? "" : "",
    alt_address_line1: alt ? article.alt?.line1 ?? "" : "",
    alt_address_line2: alt ? optionalText(article.alt?.line2) : "",
    alt_address_line3: alt ? optionalText(article.alt?.line3) : "",
    alt_city: alt ? article.alt?.city ?? "" : "",
    alt_state: alt ? optionalText(article.alt?.state) : "",
    alt_pincode: alt ? article.alt?.pincode ?? "" : "",
    alt_email_id: alt ? optionalText(article.alt?.email) : "",
    alt_contact_no: alt ? article.alt?.contact || "" : "",
    alt_alternate_mobile_no: alt ? article.alt?.mobile ?? "" : "",
  };
  return payload;
}

export function indiaPostBookingPayloadKeys(payload: Record<string, unknown>) {
  return Object.keys(payload);
}

export function assertPayloadCoversDocumentedFields(payload: Record<string, unknown>) {
  const missing = CEPT_BOOKING_FIELD_NAMES.filter((name) => !(name in payload));
  return missing;
}

/**
 * Backward-compatible Self Booking helper. New code should map + validate first,
 * then call serializeIndiaPostBookingArticle.
 */
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
  paymentMode?: string | null;
  codAmount?: number | null;
}) {
  const article: ValidatedArticle = {
    serviceCode: input.serviceCode,
    customerId: input.customerId,
    contractId: input.contractId,
    barcode: input.barcode,
    pickupOrDropoff: "DROPOFF",
    officeId: String(input.officeId),
    originPin: input.originPin,
    weightGrams: Math.max(1, Math.round(Number(input.weightGrams) || 1)),
    lengthCm: Math.max(0, Number(input.lengthCm) || 0),
    widthCm: Math.max(0, Number(input.widthCm) || 0),
    heightCm: Math.max(0, Number(input.heightCm) || 0),
    sender: {
      name: indiaPostRequiredText(input.senderName, "Merchant"),
      company: indiaPostRequiredText(input.senderCompany, input.senderName || "Merchant"),
      line1: indiaPostRequiredText(input.senderLine1, "Registered pickup"),
      line2: input.senderLine2 ?? undefined,
      city: indiaPostRequiredText(input.senderCity, input.senderCity || "City"),
      state: indiaPostRequiredText(input.senderState, input.senderState || "State"),
      pincode: input.originPin,
      mobile: input.senderMobile,
    },
    receiver: {
      name: indiaPostRequiredText(input.receiverName, "Customer"),
      company: indiaPostRequiredText(input.receiverName, "Customer"),
      line1: indiaPostRequiredText(input.receiverLine1, "Address"),
      line2: input.receiverLine2 ?? undefined,
      city: indiaPostRequiredText(input.receiverCity, "City"),
      state: indiaPostRequiredText(input.receiverState, "State"),
      pincode: input.receiverPin,
      mobile: input.receiverMobile,
    },
    pickup: null,
    alt: null,
    altAddressEnabled: false,
    paymentMode: String(input.paymentMode ?? "").toUpperCase() === "COD" ? "COD" : "PREPAID",
    codAmount: Number(input.codAmount) || 0,
    codKind: String(input.paymentMode ?? "").toUpperCase() === "COD" ? "COD" : "",
    insuranceType: "",
    insuranceValue: 0,
    ack: false,
    reg: false,
    strictDimensions: false,
    strictWeight: false,
  };
  return serializeIndiaPostBookingArticle(article);
}
