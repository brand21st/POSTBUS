import { AppError, ERROR_CODES } from "@/lib/api/errors";

export type BarcodeRangeInput = {
  prefix: string;
  suffix?: string;
  startNumber: number | string;
  endNumber: number | string;
  serviceCode?: string | null;
};

export type BarcodeRange = {
  prefix: string;
  suffix: string;
  startNumber: number;
  endNumber: number;
  serviceCode: string | null;
};

/**
 * India Post / UPU S10 article numbers are 13 characters:
 * two-letter prefix, eight-digit serial, one check digit, two-letter country (IN).
 * CEPT writes allotted ranges as ET21433001XIN — the X is this check digit.
 */
export const BARCODE_SERIAL_DIGITS = 8;
const PREFIX_PATTERN = /^[A-Z]{2}$/;
const SUFFIX_PATTERN = /^[A-Z]{2}$/;
const MAX_NUMBER = 10 ** BARCODE_SERIAL_DIGITS - 1;
const S10_WEIGHTS = [8, 6, 4, 2, 3, 5, 9, 7];

export function indiaPostS10CheckDigit(serialEightDigits: string) {
  const digits = serialEightDigits.replace(/\D/g, "").padStart(BARCODE_SERIAL_DIGITS, "0");
  if (digits.length !== BARCODE_SERIAL_DIGITS) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Barcode serial must be 8 digits.");
  }
  const sum = S10_WEIGHTS.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
  const remainder = sum % 11;
  const check = 11 - remainder;
  if (check === 10) return 0;
  if (check === 11) return 5;
  return check;
}

export function formatBarcode(prefix: string, serialNumber: number, suffix: string) {
  const serial = String(serialNumber).padStart(BARCODE_SERIAL_DIGITS, "0");
  return `${prefix}${serial}${indiaPostS10CheckDigit(serial)}${suffix}`;
}

export function parseBarcodeRange(input: BarcodeRangeInput): BarcodeRange {
  const prefix = (input.prefix ?? "").trim().toUpperCase();
  const suffix = ((input.suffix ?? "IN") || "IN").trim().toUpperCase();

  if (!PREFIX_PATTERN.test(prefix)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "Barcode prefix must be the two letters India Post allotted, for example ET or CL."
    );
  }
  if (!SUFFIX_PATTERN.test(suffix)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "Barcode suffix must be two letters, normally IN."
    );
  }

  const startNumber = Number(input.startNumber);
  const endNumber = Number(input.endNumber);

  for (const [name, value] of [
    ["Start number", startNumber],
    ["End number", endNumber],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, `${name} must be a whole number above zero.`);
    }
    if (value > MAX_NUMBER) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `${name} cannot be longer than ${BARCODE_SERIAL_DIGITS} digits.`
      );
    }
  }

  if (endNumber < startNumber) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "End number must be the same as or above the start number."
    );
  }

  return {
    prefix,
    suffix,
    startNumber,
    endNumber,
    serviceCode: input.serviceCode?.trim() || null,
  };
}

/** Serials from the CEPT UAT document. Prefix ET or CL still must not be used on production. */
export function isCeptUatTestSeries(prefix: string, startNumber: number, endNumber: number) {
  void prefix;
  return startNumber === 21433001 && endNumber === 21434000;
}

const S10_ARTICLE = /^[A-Z]{2}[0-9]{9}[A-Z]{2}$/;

export function normalizeIndiaPostArticleId(value?: unknown) {
  const article = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  return S10_ARTICLE.test(article) ? article : "";
}

/** Prefer the article India Post accepted on booking; otherwise the S10 we submitted. */
export function indiaPostAcceptedArticleId(
  valid?: {
    article_number?: unknown;
    barcode_no?: unknown;
    barcode?: unknown;
    consignment_number?: unknown;
  } | null,
  fallback = ""
) {
  const fromBooking = [
    valid?.article_number,
    valid?.barcode_no,
    valid?.barcode,
    valid?.consignment_number,
  ]
    .map(normalizeIndiaPostArticleId)
    .find(Boolean);
  return fromBooking || normalizeIndiaPostArticleId(fallback) || fallback;
}

export function indiaPostPublicTrackingUrl(articleId: string) {
  const article = normalizeIndiaPostArticleId(articleId) || articleId.trim().toUpperCase();
  return `https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?articleid=${encodeURIComponent(article)}`;
}
