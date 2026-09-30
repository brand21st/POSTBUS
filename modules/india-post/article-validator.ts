import { isValidIndiaPostS10 } from "@/modules/india-post/barcode";
import { indiaPostBookingArticleType, indiaPostMobile, indiaPostShapeOfArticle } from "@/modules/india-post/endpoints";
import type { BookingErrorCategory } from "@/modules/india-post/article-fields";
import type { DraftArticle, ValidationIssue, ValidatedArticle } from "@/modules/india-post/article-types";
import { INDIA_POST_WEIGHT_MAX_G, INDIA_POST_WEIGHT_MIN_G, toIndiaPostPhysicalWeightGrams } from "@/modules/india-post/weight";

const PIN = /^\d{6}$/;
const OFFICE = /^\d{8}$/;
const CUSTOMER = /^\d{10}$/;
const CONTRACT = /^\d{8}$/;
const SLOT = /^(10:00-13:00|13:00-16:00)$/;
const PICKUP_DATE = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} (AM|PM)$/;

type Limits = { weightMax: number; length: [number, number]; width: [number, number]; height: [number, number] };

function parcelLimits(): Limits {
  return { weightMax: 35_000, length: [14, 150], width: [9, 150], height: [1, 150] };
}

function docLimits(): Limits {
  return { weightMax: 500, length: [1, 42], width: [1, 29], height: [1, 2] };
}

function parsplLimits(): Limits {
  return { weightMax: 5_000, length: [14, 150], width: [9, 150], height: [1, 150] };
}

export function indiaPostDimensionLimits(serviceCode: string): Limits {
  const type = indiaPostBookingArticleType(serviceCode);
  if (type === "24_SPP_PARSPL") return parsplLimits();
  if (type === "24_SPEEDPOST_DOC" || type === "48_SPEEDPOST_DOC") return docLimits();
  if (type === "BP" || serviceCode === "SP_INLAND_PARCEL") return parcelLimits();
  if (serviceCode === "SP_INLAND_DOC") return docLimits();
  return parcelLimits();
}

export function isParcelArticle(serviceCode: string, weightGrams: number) {
  const type = indiaPostBookingArticleType(serviceCode);
  if (type === "BP" || type === "24_SPP_PARSPL" || serviceCode === "SP_INLAND_PARCEL") return true;
  if (weightGrams >= 500 && type === "SP") return true;
  return false;
}

function issue(
  draft: DraftArticle,
  field: string,
  value: unknown,
  error: string,
  category: BookingErrorCategory
): ValidationIssue {
  return {
    orderId: draft.orderId,
    orderNumber: draft.orderNumber,
    barcode: draft.barcode,
    field,
    value: value == null ? "" : String(value),
    error,
    status: "Failed",
    category,
  };
}

function trimText(value?: string | null) {
  return (value ?? "").trim();
}

function checkText(
  draft: DraftArticle,
  field: string,
  value: string,
  required: boolean,
  category: BookingErrorCategory,
  issues: ValidationIssue[]
) {
  const text = trimText(value);
  if (!text) {
    if (required) issues.push(issue(draft, field, text, `${field} is required.`, category));
    return;
  }
  if (text.length < 3 || text.length > 80) {
    issues.push(issue(draft, field, text, `${field} must be between 3 and 80 characters.`, category));
  }
}

function checkPin(
  draft: DraftArticle,
  field: string,
  value: string,
  required: boolean,
  category: BookingErrorCategory,
  issues: ValidationIssue[]
) {
  const pin = trimText(value);
  if (!pin) {
    if (required) issues.push(issue(draft, field, pin, `${field} must be exactly 6 digits.`, category));
    return;
  }
  if (!PIN.test(pin)) {
    issues.push(issue(draft, field, pin, `${field} must be exactly 6 digits.`, category));
  }
}

function checkMobile(
  draft: DraftArticle,
  field: string,
  value: string,
  required: boolean,
  category: BookingErrorCategory,
  issues: ValidationIssue[]
) {
  const mobile = indiaPostMobile(value);
  if (!mobile) {
    if (required || trimText(value)) {
      issues.push(
        issue(draft, field, value, `${field} must be a 10-digit Indian number starting with 6, 7, 8 or 9.`, category)
      );
    }
  }
}

export function isValidIndiaPostBarcode(barcode: string) {
  return isValidIndiaPostS10(barcode);
}

export function validateIndiaPostArticle(draft: DraftArticle): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const config: BookingErrorCategory = "POSTBUS_CONFIG";
  const shopify: BookingErrorCategory = "SHOPIFY_DATA";
  const mapping: BookingErrorCategory = "MAPPING";
  const ip: BookingErrorCategory = "INDIA_POST_VALIDATION";

  if (!CUSTOMER.test(String(draft.customerId ?? ""))) {
    issues.push(issue(draft, "bulk_customer_id", draft.customerId, "India Post customer ID must be 10 digits.", config));
  }
  if (!CONTRACT.test(String(draft.contractId ?? ""))) {
    issues.push(
      issue(
        draft,
        "contract_id",
        draft.contractId,
        "No India Post contract is configured for the selected service.",
        config
      )
    );
  }
  if (draft.barcode) {
    if (!isValidIndiaPostBarcode(draft.barcode)) {
      issues.push(issue(draft, "barcode_no", draft.barcode, "Barcode must be a valid 13-character S10 article number.", ip));
    }
  }

  if (draft.pickupOrDropoff !== "PICKUP" && draft.pickupOrDropoff !== "DROPOFF") {
    issues.push(issue(draft, "pickup_or_dropoff", draft.pickupOrDropoff, "Pickup or dropoff must be PICKUP or DROPOFF.", mapping));
  }
  if (!OFFICE.test(String(draft.officeId ?? ""))) {
    issues.push(
      issue(
        draft,
        "pickup_dropoff_office_id",
        draft.officeId,
        "Pickup/drop-off office ID must be an 8-digit India Post office id.",
        config
      )
    );
  }

  const weight = toIndiaPostPhysicalWeightGrams(draft.weightGrams);
  if (weight == null || weight < INDIA_POST_WEIGHT_MIN_G || weight > INDIA_POST_WEIGHT_MAX_G) {
    issues.push(
      issue(
        draft,
        "physical_weight",
        draft.weightGrams,
        "Physical weight must be a whole number between 1 and 35000 grams.",
        draft.strictWeight === false ? mapping : shopify
      )
    );
  }

  const parcel = isParcelArticle(draft.serviceCode, weight ?? 0);
  const limits = indiaPostDimensionLimits(draft.serviceCode);
  const length = Number(draft.lengthCm) || 0;
  const width = Number(draft.widthCm) || 0;
  const height = Number(draft.heightCm) || 0;
  const dimsMissing = length <= 0 || width <= 0 || height <= 0;
  if (parcel && (draft.strictDimensions !== false) && dimsMissing) {
    issues.push(
      issue(draft, "length", length, "Parcel length, breadth and height are required and must be within India Post limits.", shopify)
    );
  } else if (!dimsMissing) {
    if (length < limits.length[0] || length > limits.length[1]) {
      issues.push(issue(draft, "length", length, `Length must be between ${limits.length[0]} and ${limits.length[1]} cm.`, ip));
    }
    if (width < limits.width[0] || width > limits.width[1]) {
      issues.push(
        issue(draft, "breadth_diameter", width, `Breadth/diameter must be between ${limits.width[0]} and ${limits.width[1]} cm.`, ip)
      );
    }
    if (height < limits.height[0] || height > limits.height[1]) {
      issues.push(issue(draft, "height", height, `Height must be between ${limits.height[0]} and ${limits.height[1]} cm.`, ip));
    }
  }

  if (weight != null && weight > limits.weightMax) {
    issues.push(
      issue(draft, "physical_weight", weight, `Weight must be at most ${limits.weightMax} grams for this service.`, ip)
    );
  }

  const shape = (draft.shape || indiaPostShapeOfArticle(draft.serviceCode, weight ?? 0)).toUpperCase();
  if (!["ROLL", "NROL", "DOC"].includes(shape)) {
    issues.push(issue(draft, "shape_of_article", shape, "Shape of article must be ROLL, NROL or DOC.", ip));
  }

  checkText(draft, "sender_name", draft.sender.name, true, config, issues);
  checkText(draft, "sender_company", draft.sender.company, true, config, issues);
  checkText(draft, "sender_add_line_1", draft.sender.line1, true, config, issues);
  if (trimText(draft.sender.line2)) checkText(draft, "sender_add_line_2", draft.sender.line2 ?? "", false, config, issues);
  checkText(draft, "sender_city", draft.sender.city, true, config, issues);
  if (trimText(draft.sender.state)) checkText(draft, "sender_state", draft.sender.state ?? "", false, config, issues);
  checkPin(draft, "sender_pincode", draft.sender.pincode, true, config, issues);
  checkMobile(draft, "sender_mobile_no", draft.sender.mobile, true, config, issues);

  checkText(draft, "receiver_name", draft.receiver.name, true, shopify, issues);
  checkText(draft, "receiver_company", draft.receiver.company, true, shopify, issues);
  checkText(draft, "receiver_add_line_1", draft.receiver.line1, true, shopify, issues);
  if (trimText(draft.receiver.line2)) checkText(draft, "receiver_add_line_2", draft.receiver.line2 ?? "", false, shopify, issues);
  checkText(draft, "receiver_city", draft.receiver.city, true, shopify, issues);
  if (trimText(draft.receiver.state)) checkText(draft, "receiver_state", draft.receiver.state ?? "", false, shopify, issues);
  checkPin(draft, "receiver_pincode", draft.receiver.pincode, true, shopify, issues);
  checkMobile(draft, "receiver_mobile_no", draft.receiver.mobile, true, shopify, issues);

  if (draft.pickupOrDropoff === "DROPOFF") {
    checkPin(draft, "drop_off_pincode", draft.originPin, true, config, issues);
  }

  if (draft.pickupOrDropoff === "PICKUP") {
    const pickup = draft.pickup;
    if (!pickup) {
      issues.push(issue(draft, "pickup_address_flag", "TRUE", "Pickup fields are required when mode is PICKUP.", config));
    } else {
      checkText(draft, "pickup_addressee_name", pickup.addresseeName, true, config, issues);
      checkText(draft, "pickup_company_name", pickup.companyName, true, config, issues);
      checkText(draft, "pickup_address_line1", pickup.line1, true, config, issues);
      checkText(draft, "pickup_city", pickup.city, true, config, issues);
      checkPin(draft, "pickup_pincode", pickup.pincode, true, config, issues);
      checkMobile(draft, "pickup_mobile_no", pickup.mobile, true, config, issues);
      if (!SLOT.test(pickup.scheduleSlot)) {
        issues.push(
          issue(draft, "pickup_schedule_slot", pickup.scheduleSlot, "Pickup schedule slot must be 10:00-13:00 or 13:00-16:00.", ip)
        );
      }
      if (!PICKUP_DATE.test(pickup.scheduleDate)) {
        issues.push(
          issue(
            draft,
            "pickup_schedule_date",
            pickup.scheduleDate,
            "Pickup schedule date must be MM/DD/YYYY HH:MM:SS AM/PM.",
            ip
          )
        );
      }
    }
  }

  if (draft.altAddressEnabled) {
    const alt = draft.alt;
    if (!alt) {
      issues.push(issue(draft, "alt_address_flag", "TRUE", "Alternate address fields are required when enabled.", mapping));
    } else {
      checkText(draft, "alt_addressee_name", alt.addresseeName, true, mapping, issues);
      checkText(draft, "alt_company_name", alt.companyName, true, mapping, issues);
      checkText(draft, "alt_address_line1", alt.line1, true, mapping, issues);
      checkText(draft, "alt_city", alt.city, true, mapping, issues);
      checkPin(draft, "alt_pincode", alt.pincode, true, mapping, issues);
      checkMobile(draft, "alt_alternate_mobile_no", alt.mobile, true, mapping, issues);
    }
  }

  if (draft.paymentMode === "COD") {
    if (!(Number(draft.codAmount) > 0)) {
      issues.push(issue(draft, "value_for_codr_cod", draft.codAmount, "COD amount must be greater than 0.", shopify));
    }
  }

  if (draft.insuranceType && draft.insuranceType !== "DOP") {
    issues.push(issue(draft, "insurance_type", draft.insuranceType, "Insurance type must be DOP when set.", ip));
  }
  if (draft.insuranceType === "DOP" && !(Number(draft.insuranceValue) > 0)) {
    issues.push(issue(draft, "value_of_insurance", draft.insuranceValue, "Insurance value is required when insurance is DOP.", ip));
  }

  if (draft.prepaymentCode && !["QR", "SQ"].includes(draft.prepaymentCode)) {
    issues.push(issue(draft, "prepayment_code", draft.prepaymentCode, "Prepayment code must be QR or SQ.", ip));
  }

  if (draft.deliveryInstruction && !["ND", "OD", "SD"].includes(draft.deliveryInstruction)) {
    issues.push(issue(draft, "delivery_instruction", draft.deliveryInstruction, "Delivery instruction must be ND, OD or SD.", ip));
  }
  if (draft.instructionRts && !["RTS", "RTA"].includes(draft.instructionRts)) {
    issues.push(issue(draft, "instruction_rts", draft.instructionRts, "Instruction RTS must be RTS or RTA.", ip));
  }

  return issues;
}

export function assertValidatedArticle(draft: DraftArticle): ValidatedArticle {
  const issues = validateIndiaPostArticle(draft);
  if (issues.length) {
    const error = Object.assign(new Error(issues[0].error), {
      code: "VALIDATION_ERROR",
      issues,
    });
    throw error;
  }
  return draft as ValidatedArticle;
}
