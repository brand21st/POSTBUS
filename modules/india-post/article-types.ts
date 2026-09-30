export type DraftParty = {
  name: string;
  company: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  pincode: string;
  mobile: string;
  email?: string;
  altContact?: string;
  kyc?: string;
  taxReference?: string;
};

export type DraftPickup = {
  addresseeName: string;
  companyName: string;
  line1: string;
  line2?: string;
  line3?: string;
  city: string;
  state?: string;
  pincode: string;
  email?: string;
  altContact?: string;
  mobile: string;
  scheduleSlot: string;
  scheduleDate: string;
  addressId?: string;
};

export type DraftAltAddress = {
  addresseeName: string;
  companyName: string;
  line1: string;
  line2?: string;
  line3?: string;
  city: string;
  state?: string;
  pincode: string;
  email?: string;
  contact?: string;
  mobile: string;
};

export type DraftArticle = {
  orderId?: string;
  orderNumber?: string;
  shipmentId?: string;
  excelSerial?: string;
  serviceCode: string;
  customerId: string;
  contractId: string;
  barcode?: string;
  pickupOrDropoff: "PICKUP" | "DROPOFF";
  officeId: string;
  originPin: string;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  shape?: string;
  priorityFlag?: string;
  deliveryInstruction?: string;
  deliverySlot?: string;
  instructionRts?: string;
  sender: DraftParty;
  receiver: DraftParty;
  pickup?: DraftPickup | null;
  alt?: DraftAltAddress | null;
  altAddressEnabled: boolean;
  paymentMode: "PREPAID" | "COD";
  codAmount: number;
  codKind?: "COD" | "CODR" | "";
  insuranceType?: string;
  insuranceValue?: number;
  ack?: boolean;
  reg?: boolean;
  prepaymentCode?: string;
  prepaymentValue?: number;
  bulkReference?: string;
  strictWeight?: boolean;
  strictDimensions?: boolean;
};

export type ValidationIssue = {
  orderId?: string;
  orderNumber?: string;
  barcode?: string;
  field: string;
  value: string;
  error: string;
  status: "Failed";
  category: import("@/modules/india-post/article-fields").BookingErrorCategory;
};

export type ValidatedArticle = DraftArticle & {
  barcode: string;
  pickupOrDropoff: "PICKUP" | "DROPOFF";
};
