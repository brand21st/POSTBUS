import { fillSheetTemplate, type TemplateCellKind } from "@/lib/xlsx/template-clone";
import type { SheetCell } from "@/lib/xlsx/write";
import { ARTICLE_DETAILS_TEMPLATE_BASE64 } from "@/modules/india-post/templates/article-details-template.generated";
import type { DraftArticle } from "@/modules/india-post/article-types";
import { INDIA_POST_FILE_BOOKING_MAX, INDIA_POST_JSON_BOOKING_MAX } from "@/modules/india-post/spec";

/**
 * India Post bulk-customer upload workbook ("ArticleDetails" + "Information").
 * Column order and header spelling follow the India Post template exactly,
 * including the trailing space in "LENGTH ", so the file uploads unchanged.
 */

export const ARTICLE_DETAILS_SHEET = "ArticleDetails";
export const ARTICLE_DETAILS_INFO_SHEET = "Information";

export const ARTICLE_DETAILS_HEADERS = [
  "SERIAL NUMBER",
  "BARCODE NO",
  "PHYSICAL WEIGHT",
  "REG",
  "OTP",
  "RECEIVER CITY",
  "RECEIVER PINCODE",
  "RECEIVER NAME",
  "RECEIVER ADD LINE 1",
  "RECEIVER ADD LINE 2",
  "RECEIVER ADD LINE 3",
  "ACK",
  "SENDER MOBILE NO",
  "RECEIVER MOBILE NO",
  "PREPAYMENT CODE",
  "VALUE OF PREPAYMENT",
  "CODR/COD",
  "VALUE FOR CODR/COD",
  "INSURANCE TYPE",
  "VALUE OF INSURANCE",
  "SHAPE OF ARTICLE",
  "LENGTH ",
  "BREADTH/DIAMETER",
  "HEIGHT",
  "PRIORITY FLAG",
  "DELIVERY INSTRUCTION",
  "DELIVERY SLOT",
  "INSTRUCTION RTS",
  "SENDER NAME",
  "SENDER COMPANY NAME",
  "SENDER CITY",
  "SENDER STATE/UT",
  "SENDER PINCODE",
  "SENDER EMAILID",
  "SENDER ALT CONTACT",
  "SENDER KYC",
  "SENDER TAX",
  "RECEIVER COMPANY NAME",
  "RECEIVER STATE/UT",
  "RECEIVER EMAILID",
  "RECEIVER ALT CONTACT",
  "RECEIVER KYC",
  "RECEIVER TAX REF",
  "ALT ADDRESS FLAG",
  "BULK REFERENCE",
  "SENDER ADD LINE 1",
  "SENDER ADD LINE 2",
  "SENDER ADD LINE 3",
] as const;

/** Rows per file: India Post's file booking cap (Approach Document: up to 5000 articles). */
export const EXCEL_BOOKING_LIMIT_MAX = INDIA_POST_FILE_BOOKING_MAX;
/** JSON booking endpoint takes "below 1000" articles per request. Shown as guidance. */
export const EXCEL_BOOKING_LIMIT_JSON_MAX = INDIA_POST_JSON_BOOKING_MAX;
export const EXCEL_BOOKING_LIMIT_DEFAULT = INDIA_POST_FILE_BOOKING_MAX;

export function normalizeExcelBookingLimit(value: unknown) {
  const raw = Number(value);
  if (value == null || value === "" || !Number.isFinite(raw)) return EXCEL_BOOKING_LIMIT_DEFAULT;
  return Math.min(EXCEL_BOOKING_LIMIT_MAX, Math.max(1, Math.floor(raw)));
}

/** Throws a user-facing message when the requested limit is outside 1..5000. */
export function parseExcelBookingLimit(value: unknown) {
  const raw = Number(value);
  if (!Number.isInteger(raw) || raw < 1 || raw > EXCEL_BOOKING_LIMIT_MAX) {
    throw new Error(`Rows per India Post file must be a whole number from 1 to ${EXCEL_BOOKING_LIMIT_MAX}.`);
  }
  return raw;
}

function amount(value: number | undefined) {
  return value && Number.isFinite(value) && value > 0 ? value : null;
}

function dimension(value: number) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function cell(value: string | undefined | null) {
  return (value ?? "").trim();
}

/** One ArticleDetails row. Booleans stay booleans; PINs and mobiles stay text. */
export function articleDetailsRow(article: DraftArticle, serial: number): SheetCell[] {
  const cod = article.paymentMode === "COD" && article.codAmount > 0;
  const values: Record<(typeof ARTICLE_DETAILS_HEADERS)[number], SheetCell> = {
    "SERIAL NUMBER": serial,
    "BARCODE NO": cell(article.barcode).toUpperCase(),
    "PHYSICAL WEIGHT": dimension(article.weightGrams),
    REG: Boolean(article.reg),
    OTP: Boolean(article.otp),
    "RECEIVER CITY": cell(article.receiver.city),
    "RECEIVER PINCODE": cell(article.receiver.pincode),
    "RECEIVER NAME": cell(article.receiver.name),
    "RECEIVER ADD LINE 1": cell(article.receiver.line1),
    "RECEIVER ADD LINE 2": cell(article.receiver.line2),
    "RECEIVER ADD LINE 3": cell(article.receiver.line3),
    ACK: Boolean(article.ack),
    "SENDER MOBILE NO": cell(article.sender.mobile),
    "RECEIVER MOBILE NO": cell(article.receiver.mobile),
    "PREPAYMENT CODE": cell(article.prepaymentCode),
    "VALUE OF PREPAYMENT": amount(article.prepaymentValue),
    "CODR/COD": cod ? (article.codKind === "CODR" ? "codr" : "cod") : "",
    "VALUE FOR CODR/COD": cod ? article.codAmount : null,
    "INSURANCE TYPE": cell(article.insuranceType),
    "VALUE OF INSURANCE": amount(article.insuranceValue),
    "SHAPE OF ARTICLE": cell(article.shape).toUpperCase(),
    "LENGTH ": dimension(article.lengthCm),
    "BREADTH/DIAMETER": dimension(article.widthCm),
    HEIGHT: dimension(article.heightCm),
    "PRIORITY FLAG": cell(article.priorityFlag).toUpperCase() === "TRUE",
    "DELIVERY INSTRUCTION": cell(article.deliveryInstruction),
    "DELIVERY SLOT": cell(article.deliverySlot),
    "INSTRUCTION RTS": cell(article.instructionRts),
    "SENDER NAME": cell(article.sender.name),
    "SENDER COMPANY NAME": cell(article.sender.company),
    "SENDER CITY": cell(article.sender.city),
    "SENDER STATE/UT": cell(article.sender.state),
    "SENDER PINCODE": cell(article.sender.pincode),
    "SENDER EMAILID": cell(article.sender.email),
    "SENDER ALT CONTACT": cell(article.sender.altContact),
    "SENDER KYC": cell(article.sender.kyc),
    "SENDER TAX": cell(article.sender.taxReference),
    "RECEIVER COMPANY NAME": cell(article.receiver.company === article.receiver.name ? "" : article.receiver.company),
    "RECEIVER STATE/UT": cell(article.receiver.state),
    "RECEIVER EMAILID": cell(article.receiver.email),
    "RECEIVER ALT CONTACT": cell(article.receiver.altContact),
    "RECEIVER KYC": cell(article.receiver.kyc),
    "RECEIVER TAX REF": cell(article.receiver.taxReference),
    "ALT ADDRESS FLAG": article.altAddressEnabled ? true : null,
    "BULK REFERENCE": cell(article.bulkReference),
    "SENDER ADD LINE 1": cell(article.sender.line1),
    "SENDER ADD LINE 2": cell(article.sender.line2),
    "SENDER ADD LINE 3": cell(article.sender.line3),
  };
  return ARTICLE_DETAILS_HEADERS.map((header) => values[header]);
}

export type ArticleDetailsPart = { part: number; from: number; to: number; count: number };

/** Split `total` rows into files of at most `limit` rows (1-based, inclusive ranges). */
export function articleDetailsParts(total: number, limit: number): ArticleDetailsPart[] {
  const size = normalizeExcelBookingLimit(limit);
  const parts: ArticleDetailsPart[] = [];
  for (let from = 1; from <= total; from += size) {
    const to = Math.min(total, from + size - 1);
    parts.push({ part: parts.length + 1, from, to, count: to - from + 1 });
  }
  return parts;
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 40) || "store"
  );
}

/** India time calendar date, yyyy-mm-dd. */
export function indiaDate(now = new Date()) {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** `{count}_{store}_{yyyy-mm-dd}_postbus.xlsx`, with `_partN` when a batch is split. */
export function articleDetailsFilename(input: {
  count: number;
  storeName: string;
  date?: string;
  part?: number;
  parts?: number;
}) {
  const part = input.parts && input.parts > 1 && input.part ? `_part${input.part}` : "";
  return `${input.count}_${slug(input.storeName)}_${input.date ?? indiaDate()}_postbus${part}.xlsx`;
}

/** Re-number SERIAL NUMBER from 1 inside each file, like the India Post template. */
export function renumberArticleDetailsRows(rows: SheetCell[][]) {
  return rows.map((row, index) => [index + 1, ...row.slice(1)]);
}

/**
 * Cell kind per column, as the India Post template stores its own sample row: serial and
 * dimensions are numbers, weight and COD value use the template's "0" number format, flags are
 * booleans, everything else (PIN codes, mobiles, barcodes, prepayment and insurance values) is text.
 */
export const ARTICLE_DETAILS_COLUMN_KINDS: Record<(typeof ARTICLE_DETAILS_HEADERS)[number], TemplateCellKind> = {
  "SERIAL NUMBER": "number",
  "BARCODE NO": "text",
  "PHYSICAL WEIGHT": "styledNumber",
  REG: "bool",
  OTP: "bool",
  "RECEIVER CITY": "text",
  "RECEIVER PINCODE": "text",
  "RECEIVER NAME": "text",
  "RECEIVER ADD LINE 1": "text",
  "RECEIVER ADD LINE 2": "text",
  "RECEIVER ADD LINE 3": "text",
  ACK: "bool",
  "SENDER MOBILE NO": "text",
  "RECEIVER MOBILE NO": "text",
  "PREPAYMENT CODE": "text",
  "VALUE OF PREPAYMENT": "text",
  "CODR/COD": "text",
  "VALUE FOR CODR/COD": "styledNumber",
  "INSURANCE TYPE": "text",
  "VALUE OF INSURANCE": "text",
  "SHAPE OF ARTICLE": "text",
  "LENGTH ": "number",
  "BREADTH/DIAMETER": "number",
  HEIGHT: "number",
  "PRIORITY FLAG": "bool",
  "DELIVERY INSTRUCTION": "text",
  "DELIVERY SLOT": "text",
  "INSTRUCTION RTS": "text",
  "SENDER NAME": "text",
  "SENDER COMPANY NAME": "text",
  "SENDER CITY": "text",
  "SENDER STATE/UT": "text",
  "SENDER PINCODE": "text",
  "SENDER EMAILID": "text",
  "SENDER ALT CONTACT": "text",
  "SENDER KYC": "text",
  "SENDER TAX": "text",
  "RECEIVER COMPANY NAME": "text",
  "RECEIVER STATE/UT": "text",
  "RECEIVER EMAILID": "text",
  "RECEIVER ALT CONTACT": "text",
  "RECEIVER KYC": "text",
  "RECEIVER TAX REF": "text",
  "ALT ADDRESS FLAG": "text",
  "BULK REFERENCE": "text",
  "SENDER ADD LINE 1": "text",
  "SENDER ADD LINE 2": "text",
  "SENDER ADD LINE 3": "text",
};

/**
 * The India Post workbook itself (sample rows removed) with these rows filled in. Every other part
 * of the file - the Information sheet, styles, theme, sheet names and order - is the template's own.
 */
export async function articleDetailsWorkbook(rows: SheetCell[][]) {
  return fillSheetTemplate({
    template: ARTICLE_DETAILS_TEMPLATE_BASE64,
    sheetPath: "xl/worksheets/sheet1.xml",
    kinds: ARTICLE_DETAILS_HEADERS.map((header) => ARTICLE_DETAILS_COLUMN_KINDS[header]),
    rows: renumberArticleDetailsRows(rows),
    headerRows: 1,
    numberStyle: 1,
  });
}
