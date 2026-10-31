import { applyWorkspaceParcelDefaults, type WorkspaceParcelDefaults } from "@/modules/india-post/parcel-defaults";
import { mapExcelRowToArticle } from "@/modules/india-post/article-mapper";
import type { ValidationIssue } from "@/modules/india-post/article-types";
import { isValidIndiaPostBarcode, validateIndiaPostArticle } from "@/modules/india-post/article-validator";
import { indiaPostBookingArticleType } from "@/modules/india-post/endpoints";
import { indiaPostRequiresOtp } from "@/modules/india-post/spec";

const EMPTY_PARCEL_DEFAULTS: WorkspaceParcelDefaults = {
  lengthCm: null,
  widthCm: null,
  heightCm: null,
  weightGrams: null,
};

export type ImportStoreDefaults = {
  serviceCode: string;
  allowedServices: string[];
  customerId: string;
  contractId: string;
  officeId: string;
  originPin: string;
  senderName: string;
  senderCompany: string;
  senderLine1: string;
  senderLine2?: string;
  senderCity: string;
  senderState?: string;
  senderPin: string;
  senderMobile: string;
  allocatableBarcodes: number;
  usedBarcodes: Set<string>;
  parcelDefaults?: WorkspaceParcelDefaults | null;
};

export type NormalizedImportArticle = {
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  barcode: string;
  paymentMode: "COD" | "PREPAID";
  codAmount: number;
  receiverName: string;
  receiverPhone: string;
  receiverEmail: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  bulkReference: string;
};

export type AssessedImportRow = {
  excelRowNumber: number;
  mapped: Record<string, string>;
  unmapped: Record<string, string>;
  issues: ValidationIssue[];
  valid: boolean;
  barcode: string;
  normalized: NormalizedImportArticle;
};

const SCIENTIFIC = /e[+-]\d+/i;

function blank(value?: string) {
  return !(value ?? "").trim();
}

function put(row: Record<string, string>, key: string, value?: string) {
  if (blank(row[key]) && (value ?? "").trim()) row[key] = value!.trim();
}

function normalizeCod(row: Record<string, string>, issues: ValidationIssue[], excelRowNumber: number) {
  const raw = (row.codr_cod ?? "").trim();
  const token = raw.toLowerCase();
  if (!token) return;
  if (token === "cod" || token === "yes" || token === "y" || token === "true" || token === "cash on delivery") {
    row.codr_cod = "COD";
    return;
  }
  if (token === "codr") {
    row.codr_cod = "CODR";
    return;
  }
  if (["no", "n", "prepaid", "paid", "false"].includes(token)) {
    row.codr_cod = "";
    return;
  }
  issues.push({
    orderNumber: String(excelRowNumber),
    field: "codr_cod",
    value: raw,
    error: "COD must be COD, CODR, or blank for prepaid.",
    status: "Failed",
    category: "MAPPING",
  });
}

const ARTICLE_KEYS = [
  "pickup_address_flag",
  "alt_address_flag",
  "physical_weight",
  "codr_cod",
  "value_for_codr_cod",
  "pickup_dropoff_office_id",
  "drop_off_pincode",
  "length",
  "breadth_diameter",
  "height",
  "shape_of_article",
  "priority_flag",
  "delivery_instruction",
  "instruction_rts",
  "sender_name",
  "sender_company",
  "sender_add_line_1",
  "sender_add_line_2",
  "sender_add_line_3",
  "sender_city",
  "sender_state",
  "sender_pincode",
  "sender_mobile_no",
  "sender_emailid",
  "receiver_name",
  "receiver_company",
  "receiver_add_line_1",
  "receiver_add_line_2",
  "receiver_add_line_3",
  "receiver_city",
  "receiver_state",
  "receiver_pincode",
  "receiver_mobile_no",
  "receiver_emailid",
  "barcode_no",
  "insurance_type",
  "value_of_insurance",
  "ack",
  "reg",
  "prepayment_code",
  "value_of_prepayment",
  "otp",
  "bulk_reference",
  "article_type",
];

function fillStore(row: Record<string, string>, defaults: ImportStoreDefaults) {
  const next: Record<string, string> = {};
  for (const key of ARTICLE_KEYS) next[key] = row[key] ?? "";
  for (const [key, value] of Object.entries(row)) {
    if (!(key in next)) next[key] = value ?? "";
  }
  put(next, "sender_name", defaults.senderName);
  put(next, "sender_company", defaults.senderCompany || defaults.senderName);
  put(next, "sender_add_line_1", defaults.senderLine1);
  put(next, "sender_add_line_2", defaults.senderLine2);
  put(next, "sender_city", defaults.senderCity);
  put(next, "sender_state", defaults.senderState);
  put(next, "sender_pincode", defaults.senderPin || defaults.originPin);
  put(next, "sender_mobile_no", defaults.senderMobile);
  put(next, "pickup_dropoff_office_id", defaults.officeId);
  put(next, "drop_off_pincode", defaults.originPin);
  if (indiaPostRequiresOtp(defaults.serviceCode)) put(next, "otp", "TRUE");
  return next;
}

function flagScientific(row: Record<string, string>, issues: ValidationIssue[], excelRowNumber: number) {
  for (const field of ["barcode_no", "receiver_pincode", "receiver_mobile_no", "sender_pincode", "sender_mobile_no"]) {
    const value = row[field] ?? "";
    if (SCIENTIFIC.test(value)) {
      issues.push({
        orderNumber: String(excelRowNumber),
        field,
        value,
        error: "This value looks like Excel scientific notation. Enter it as text.",
        status: "Failed",
        category: "MAPPING",
      });
    }
  }
}

export function canStartBulkExcelBooking(status: string) {
  return status === "validated" || status === "draft";
}

export function canResumeBulkExcelBooking(status: string) {
  return status === "booking";
}

export function importRowsAwaitingShipment<T extends { status: string; shipment_id?: string | null }>(rows: T[]) {
  return rows.filter((row) => row.status === "valid" && !row.shipment_id);
}

export function assessImportRows(
  rows: Array<{ excelRowNumber: number; mapped: Record<string, string>; unmapped: Record<string, string> }>,
  defaults: ImportStoreDefaults
): { rows: AssessedImportRow[]; batchIssues: ValidationIssue[] } {
  const batchIssues: ValidationIssue[] = [];
  if (!defaults.allowedServices.includes(defaults.serviceCode)) {
    batchIssues.push({
      field: "article_type",
      value: defaults.serviceCode,
      error: "The selected service is not on this organization's India Post contract.",
      status: "Failed",
      category: "POSTBUS_CONFIG",
    });
  }
  if (!defaults.officeId.trim()) {
    batchIssues.push({
      field: "pickup_dropoff_office_id",
      value: "",
      error: "Pickup office is not configured.",
      status: "Failed",
      category: "POSTBUS_CONFIG",
    });
  }
  const seen = new Set<string>();
  let allocations = 0;
  const assessed: AssessedImportRow[] = rows.map((row) => {
    const issues: ValidationIssue[] = [];
    const filled = fillStore(row.mapped, defaults);
    normalizeCod(filled, issues, row.excelRowNumber);
    flagScientific(filled, issues, row.excelRowNumber);
    const requested = (filled.article_type ?? "").trim();
    if (requested) {
      const code = indiaPostBookingArticleType(requested);
      if (code !== defaults.serviceCode) {
        issues.push({
          orderNumber: String(row.excelRowNumber),
          field: "article_type",
          value: requested,
          error: `Row service ${code} does not match the selected service ${defaults.serviceCode}.`,
          status: "Failed",
          category: "MAPPING",
        });
      }
    }
    const draft = applyWorkspaceParcelDefaults(
      mapExcelRowToArticle({
        serial: String(row.excelRowNumber),
        serviceCode: defaults.serviceCode,
        customerId: defaults.customerId,
        contractId: defaults.contractId,
        officeId: defaults.officeId,
        originPin: defaults.originPin,
        row: filled,
      }),
      defaults.parcelDefaults ?? EMPTY_PARCEL_DEFAULTS
    );
    issues.push(...validateIndiaPostArticle(draft));
    const barcode = (draft.barcode || "").trim().toUpperCase();
    if (barcode) {
      if (!isValidIndiaPostBarcode(barcode)) {
        issues.push({
          orderNumber: String(row.excelRowNumber),
          barcode,
          field: "barcode_no",
          value: barcode,
          error: "Barcode must be a valid unique S10 article number.",
          status: "Failed",
          category: "INDIA_POST_VALIDATION",
        });
      }
      if (seen.has(barcode) || defaults.usedBarcodes.has(barcode)) {
        issues.push({
          orderNumber: String(row.excelRowNumber),
          barcode,
          field: "barcode_no",
          value: barcode,
          error: "Duplicate barcode.",
          status: "Failed",
          category: "MAPPING",
        });
      }
      seen.add(barcode);
    } else {
      allocations += 1;
      if (allocations > defaults.allocatableBarcodes) {
        issues.push({
          orderNumber: String(row.excelRowNumber),
          field: "barcode_no",
          value: "",
          error: "Not enough barcodes are left in the allocated range.",
          status: "Failed",
          category: "BOOKING",
        });
      }
    }
    if (batchIssues.length) issues.push(...batchIssues);
    const normalized: NormalizedImportArticle = {
      weightGrams: draft.weightGrams,
      lengthCm: draft.lengthCm,
      widthCm: draft.widthCm,
      heightCm: draft.heightCm,
      barcode,
      paymentMode: draft.paymentMode,
      codAmount: draft.codAmount,
      receiverName: draft.receiver.name,
      receiverPhone: draft.receiver.mobile,
      receiverEmail: draft.receiver.email ?? "",
      line1: draft.receiver.line1,
      line2: draft.receiver.line2 ?? "",
      city: draft.receiver.city,
      state: draft.receiver.state ?? "",
      pincode: draft.receiver.pincode,
      bulkReference: draft.bulkReference ?? "",
    };
    return {
      excelRowNumber: row.excelRowNumber,
      mapped: filled,
      unmapped: row.unmapped,
      issues,
      valid: issues.length === 0,
      barcode,
      normalized,
    };
  });
  return { rows: assessed, batchIssues };
}
