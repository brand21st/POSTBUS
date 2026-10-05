import { indiaPostBookingArticleType, indiaPostMobile, indiaPostShapeOfArticle } from "@/modules/india-post/endpoints";
import { INDIA_POST_BULK_REFERENCE_MAX, indiaPostRequiresOtp } from "@/modules/india-post/spec";
import type { DraftArticle, DraftParty } from "@/modules/india-post/article-types";
import { toIndiaPostPhysicalWeightGrams } from "@/modules/india-post/weight";

function text(value?: string | null) {
  return (value ?? "").trim();
}

function party(input: {
  name?: string | null;
  company?: string | null;
  line1?: string | null;
  line2?: string | null;
  line3?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  mobile?: string | null;
  email?: string | null;
}): DraftParty {
  const name = text(input.name);
  const company = text(input.company) || name;
  return {
    name,
    company,
    line1: text(input.line1),
    line2: text(input.line2) || undefined,
    line3: text(input.line3) || undefined,
    city: text(input.city),
    state: text(input.state) || undefined,
    pincode: text(input.pincode),
    mobile: indiaPostMobile(input.mobile) || text(input.mobile),
    email: text(input.email) || undefined,
  };
}

export function mapShipmentToArticle(input: {
  orderId?: string;
  orderNumber?: string;
  shipmentId?: string;
  serviceCode: string;
  customerId: string;
  contractId: string;
  barcode?: string;
  officeId: string;
  originPin: string;
  weightGrams: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  senderName: string;
  senderCompany: string;
  senderLine1: string;
  senderLine2?: string | null;
  senderCity: string;
  senderState?: string | null;
  senderPin: string;
  senderMobile: string;
  receiverName: string;
  receiverCompany?: string | null;
  receiverLine1: string;
  receiverLine2?: string | null;
  receiverCity: string;
  receiverState?: string | null;
  receiverPin: string;
  receiverMobile: string;
  receiverEmail?: string | null;
  paymentMode?: string | null;
  codAmount?: number | null;
  pickup?: DraftArticle["pickup"];
  alt?: DraftArticle["alt"];
  altAddressEnabled?: boolean;
  bulkReference?: string;
  shape?: string;
  strictWeight?: boolean;
  strictDimensions?: boolean;
}): DraftArticle {
  const pickup = Boolean(input.pickup);
  const weight = toIndiaPostPhysicalWeightGrams(input.weightGrams) ?? 0;
  const prepaid = String(input.paymentMode ?? "").toUpperCase() !== "COD";
  return {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    shipmentId: input.shipmentId,
    serviceCode: input.serviceCode,
    customerId: String(input.customerId ?? "").trim(),
    contractId: String(input.contractId ?? "").trim(),
    barcode: input.barcode,
    pickupOrDropoff: pickup ? "PICKUP" : "DROPOFF",
    officeId: String(input.officeId ?? "").trim(),
    originPin: String(input.originPin ?? "").trim(),
    weightGrams: weight,
    lengthCm: Number(input.lengthCm) || 0,
    widthCm: Number(input.widthCm) || 0,
    heightCm: Number(input.heightCm) || 0,
    shape: input.shape ? input.shape.trim().toUpperCase() : indiaPostShapeOfArticle(input.serviceCode, weight),
    sender: party({
      name: input.senderName,
      company: input.senderCompany,
      line1: input.senderLine1,
      line2: input.senderLine2,
      city: input.senderCity,
      state: input.senderState,
      pincode: input.senderPin,
      mobile: input.senderMobile,
    }),
    receiver: party({
      name: input.receiverName,
      company: input.receiverCompany,
      line1: input.receiverLine1,
      line2: input.receiverLine2,
      city: input.receiverCity,
      state: input.receiverState,
      pincode: input.receiverPin,
      mobile: input.receiverMobile,
      email: input.receiverEmail,
    }),
    pickup: input.pickup ?? null,
    alt: input.alt ?? null,
    altAddressEnabled: Boolean(input.altAddressEnabled),
    paymentMode: prepaid ? "PREPAID" : "COD",
    codAmount: prepaid ? 0 : Math.max(0, Number(input.codAmount) || 0),
    codKind: prepaid ? "" : "COD",
    insuranceType: "",
    insuranceValue: 0,
    ack: false,
    reg: false,
    bulkReference: input.bulkReference,
    strictWeight: input.strictWeight,
    strictDimensions: input.strictDimensions,
  };
}

export function mapExcelRowToArticle(input: {
  serial: string;
  serviceCode: string;
  customerId: string;
  contractId: string;
  officeId: string;
  pickupOfficeId?: string;
  originPin: string;
  row: Record<string, string>;
  pickup?: DraftArticle["pickup"];
  alt?: DraftArticle["alt"];
}): DraftArticle {
  const row = input.row;
  const flag = (value: string) => {
    const textValue = value.trim().toUpperCase();
    return textValue === "1" || textValue === "TRUE" || textValue === "YES";
  };
  const pickupFlag = flag(row.pickup_address_flag);
  const altFlag = flag(row.alt_address_flag);
  const weight = toIndiaPostPhysicalWeightGrams(row.physical_weight) ?? 0;
  const codRaw = row.codr_cod.trim().toLowerCase();
  const isCod = codRaw === "cod" || codRaw === "codr";
  return {
    excelSerial: input.serial,
    orderNumber: input.serial,
    serviceCode: input.serviceCode,
    customerId: input.customerId,
    contractId: input.contractId,
    barcode: row.barcode_no.trim().toUpperCase() || undefined,
    pickupOrDropoff: pickupFlag ? "PICKUP" : "DROPOFF",
    officeId:
      row.pickup_dropoff_office_id.trim() ||
      (pickupFlag ? input.pickupOfficeId?.trim() || input.officeId : input.officeId),
    originPin: row.drop_off_pincode.trim() || input.originPin,
    weightGrams: weight,
    lengthCm: Number(row.length) || 0,
    widthCm: Number(row.breadth_diameter) || 0,
    heightCm: Number(row.height) || 0,
    shape: row.shape_of_article.trim().toUpperCase() || indiaPostShapeOfArticle(input.serviceCode, weight),
    priorityFlag: flag(row.priority_flag) ? "TRUE" : row.priority_flag.trim() ? "FALSE" : "",
    deliveryInstruction: row.delivery_instruction.trim().toUpperCase(),
    instructionRts: row.instruction_rts.trim().toUpperCase(),
    sender: party({
      name: row.sender_name,
      company: row.sender_company,
      line1: row.sender_add_line_1,
      line2: row.sender_add_line_2,
      line3: row.sender_add_line_3,
      city: row.sender_city,
      state: row.sender_state,
      pincode: row.sender_pincode,
      mobile: row.sender_mobile_no,
      email: row.sender_emailid,
    }),
    receiver: party({
      name: row.receiver_name,
      company: row.receiver_company,
      line1: row.receiver_add_line_1,
      line2: row.receiver_add_line_2,
      line3: row.receiver_add_line_3,
      city: row.receiver_city,
      state: row.receiver_state,
      pincode: row.receiver_pincode,
      mobile: row.receiver_mobile_no,
      email: row.receiver_emailid,
    }),
    pickup: pickupFlag ? input.pickup ?? null : null,
    alt: altFlag ? input.alt ?? null : null,
    altAddressEnabled: altFlag,
    paymentMode: isCod ? "COD" : "PREPAID",
    codAmount: isCod ? Number(row.value_for_codr_cod) || 0 : 0,
    codKind: isCod ? (codRaw === "codr" ? "CODR" : "COD") : "",
    insuranceType: row.insurance_type.trim().toUpperCase(),
    insuranceValue: Number(row.value_of_insurance) || 0,
    ack: flag(row.ack),
    reg: flag(row.reg),
    prepaymentCode: row.prepayment_code.trim().toUpperCase(),
    prepaymentValue: Number(row.value_of_prepayment) || 0,
    otp: indiaPostRequiresOtp(input.serviceCode) ? true : flag(row.otp) ? true : false,
    bulkReference: row.bulk_reference.trim().slice(0, INDIA_POST_BULK_REFERENCE_MAX),
    strictWeight: true,
    strictDimensions: true,
  };
}

export { indiaPostBookingArticleType };
