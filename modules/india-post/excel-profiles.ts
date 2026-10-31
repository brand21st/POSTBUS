/** Column aliases for merchant Excel. CEPT names stay the destination keys used by mapExcelRowToArticle. */

export const IMPORT_FORMATS = ["postbridge", "cept_official", "postbus_standard"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export const MERCHANT_BOOKING_FIELDS: Array<{ key: string; label: string }> = [
  { key: "barcode_no", label: "Barcode" },
  { key: "physical_weight", label: "Weight (grams)" },
  { key: "receiver_name", label: "Receiver name" },
  { key: "receiver_mobile_no", label: "Receiver mobile" },
  { key: "receiver_pincode", label: "Receiver PIN" },
  { key: "receiver_add_line_1", label: "Address line 1" },
  { key: "receiver_add_line_2", label: "Address line 2" },
  { key: "receiver_add_line_3", label: "Address line 3" },
  { key: "receiver_city", label: "City" },
  { key: "receiver_state", label: "State" },
  { key: "receiver_emailid", label: "Receiver email" },
  { key: "receiver_company", label: "Receiver company" },
  { key: "codr_cod", label: "COD / CODR" },
  { key: "value_for_codr_cod", label: "COD amount" },
  { key: "bulk_reference", label: "Order reference" },
  { key: "shape_of_article", label: "Shape" },
  { key: "length", label: "Length (cm)" },
  { key: "breadth_diameter", label: "Breadth (cm)" },
  { key: "height", label: "Height (cm)" },
  { key: "article_type", label: "Service" },
  { key: "serial_number", label: "Serial" },
  { key: "sender_name", label: "Sender name" },
  { key: "sender_mobile_no", label: "Sender mobile" },
  { key: "sender_add_line_1", label: "Sender address" },
  { key: "sender_city", label: "Sender city" },
  { key: "sender_state", label: "Sender state" },
  { key: "sender_pincode", label: "Sender PIN" },
  { key: "insurance_type", label: "Insurance type" },
  { key: "value_of_insurance", label: "Insurance value" },
  { key: "otp", label: "OTP delivery" },
  { key: "pickup_address_flag", label: "Pickup flag" },
  { key: "pickup_dropoff_office_id", label: "Office id" },
];

/** Official CEPT ArticleDetails headers. */
export const CEPT_HEADER_FIELDS: Record<string, string> = {
  "SERIAL NUMBER": "serial_number",
  "BARCODE NO": "barcode_no",
  "PHYSICAL WEIGHT": "physical_weight",
  "SHAPE OF ARTICLE": "shape_of_article",
  LENGTH: "length",
  "BREADTH/DIAMETER": "breadth_diameter",
  HEIGHT: "height",
  "PRIORITY FLAG": "priority_flag",
  "DELIVERY INSTRUCTION": "delivery_instruction",
  "INSTRUCTION RTS": "instruction_rts",
  "SENDER NAME": "sender_name",
  "SENDER COMPANY": "sender_company",
  "SENDER ADD LINE 1": "sender_add_line_1",
  "SENDER ADD LINE 2": "sender_add_line_2",
  "SENDER ADD LINE 3": "sender_add_line_3",
  "SENDER CITY": "sender_city",
  "SENDER STATE": "sender_state",
  "SENDER PINCODE": "sender_pincode",
  "SENDER EMAILID": "sender_emailid",
  "SENDER MOBILE NO": "sender_mobile_no",
  "RECEIVER NAME": "receiver_name",
  "RECEIVER COMPANY": "receiver_company",
  "RECEIVER ADD LINE 1": "receiver_add_line_1",
  "RECEIVER ADD LINE 2": "receiver_add_line_2",
  "RECEIVER ADD LINE 3": "receiver_add_line_3",
  "RECEIVER CITY": "receiver_city",
  "RECEIVER STATE": "receiver_state",
  "RECEIVER PINCODE": "receiver_pincode",
  "RECEIVER EMAILID": "receiver_emailid",
  "RECEIVER MOBILE NO": "receiver_mobile_no",
  "ALT ADDRESS FLAG": "alt_address_flag",
  "PICKUP ADDRESS FLAG": "pickup_address_flag",
  "DROP OFF PINCODE": "drop_off_pincode",
  "DROPOFF/PICKUP OFFICE ID": "pickup_dropoff_office_id",
  "CODR/COD": "codr_cod",
  "VALUE FOR CODR/COD": "value_for_codr_cod",
  "INSURANCE TYPE": "insurance_type",
  "VALUE OF INSURANCE": "value_of_insurance",
  ACK: "ack",
  REGISTRATION: "reg",
  "OTP BASED DELIVERY": "otp",
  "BULK REFERENCE": "bulk_reference",
  "ARTICLE TYPE": "article_type",
  "PREPAYMENT CODE": "prepayment_code",
  "VALUE OF PREPAYMENT": "value_of_prepayment",
};

/** Short merchant headers. Used for PostBridge and the PostBus template, not the official CEPT sheet. */
export const POSTBRIDGE_HEADER_FIELDS: Record<string, string> = {
  BARCODE: "barcode_no",
  AWB: "barcode_no",
  "AWB NO": "barcode_no",
  "TRACKING NUMBER": "barcode_no",
  WEIGHT: "physical_weight",
  "WEIGHT (G)": "physical_weight",
  "WEIGHT GRAMS": "physical_weight",
  "WEIGHT (GRAMS)": "physical_weight",
  "CUSTOMER NAME": "receiver_name",
  "CONSIGNEE NAME": "receiver_name",
  NAME: "receiver_name",
  MOBILE: "receiver_mobile_no",
  PHONE: "receiver_mobile_no",
  "MOBILE NO": "receiver_mobile_no",
  "PHONE NO": "receiver_mobile_no",
  PINCODE: "receiver_pincode",
  PIN: "receiver_pincode",
  "PIN CODE": "receiver_pincode",
  ADDRESS: "receiver_add_line_1",
  "ADDRESS 1": "receiver_add_line_1",
  "ADDRESS LINE 1": "receiver_add_line_1",
  "ADDRESS 2": "receiver_add_line_2",
  "ADDRESS LINE 2": "receiver_add_line_2",
  CITY: "receiver_city",
  STATE: "receiver_state",
  COD: "codr_cod",
  "COD AMOUNT": "value_for_codr_cod",
  COLLECTABLE: "value_for_codr_cod",
  "ORDER ID": "bulk_reference",
  "ORDER NUMBER": "bulk_reference",
  "ORDER NO": "bulk_reference",
  REFERENCE: "bulk_reference",
  SHAPE: "shape_of_article",
  SERVICE: "article_type",
  "SERVICE TYPE": "article_type",
};

export const POSTBRIDGE_TEMPLATE_HEADERS = [
  "ORDER ID",
  "BARCODE NO",
  "RECEIVER NAME",
  "RECEIVER MOBILE NO",
  "RECEIVER ADD LINE 1",
  "RECEIVER ADD LINE 2",
  "RECEIVER CITY",
  "RECEIVER STATE",
  "RECEIVER PINCODE",
  "PHYSICAL WEIGHT",
  "LENGTH",
  "BREADTH/DIAMETER",
  "HEIGHT",
  "SHAPE OF ARTICLE",
  "CODR/COD",
  "VALUE FOR CODR/COD",
  "BULK REFERENCE",
  "ARTICLE TYPE",
];

export function headerKey(value: string) {
  return value.replace(/\s+/g, " ").replace(/[:*]+$/g, "").trim().toUpperCase();
}

export function aliasesForFormat(format: ImportFormat) {
  if (format === "cept_official") return { ...CEPT_HEADER_FIELDS };
  return { ...CEPT_HEADER_FIELDS, ...POSTBRIDGE_HEADER_FIELDS };
}

export function detectImportFormat(headers: string[], sheetName?: string): ImportFormat {
  if ((sheetName ?? "").trim().toLowerCase() === "articledetails") return "cept_official";
  const keys = headers.map(headerKey).filter(Boolean);
  const longHits = keys.filter((key) => CEPT_HEADER_FIELDS[key]).length;
  const shortHits = keys.filter((key) => POSTBRIDGE_HEADER_FIELDS[key] && !CEPT_HEADER_FIELDS[key]).length;
  if (shortHits > 0) return "postbridge";
  if (longHits >= 3) return "cept_official";
  return "postbus_standard";
}

export function suggestColumnMap(headers: string[], format: ImportFormat) {
  const aliases = aliasesForFormat(format);
  const used = new Set<string>();
  const columnMap: Record<string, string> = {};
  const unmappedHeaders: string[] = [];
  for (const header of headers) {
    const key = headerKey(header);
    const field = key ? aliases[key] : undefined;
    if (!header.trim()) continue;
    if (!field || used.has(field)) {
      unmappedHeaders.push(header);
      continue;
    }
    used.add(field);
    columnMap[header] = field;
  }
  return { columnMap, unmappedHeaders };
}

export function isImportFormat(value: string): value is ImportFormat {
  return (IMPORT_FORMATS as readonly string[]).includes(value);
}
