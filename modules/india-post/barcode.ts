import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { IndiaPostServiceCode } from "@/types/domain";

/** CX articles are India Post Parcel Contractual (CEPT BUSINESS_PARCEL / BP). */
const PREFIX_SERVICE: Record<string, IndiaPostServiceCode> = {
  CX: "BUSINESS_PARCEL",
};

export function indiaPostServiceForBarcodePrefix(prefix: string): IndiaPostServiceCode | null {
  return PREFIX_SERVICE[prefix.trim().toUpperCase().slice(0, 2)] ?? null;
}

export function barcodePrefixAllowedForService(prefix: string, serviceCode: string) {
  const mapped = indiaPostServiceForBarcodePrefix(prefix);
  if (!mapped) return true;
  const code = serviceCode.trim().toUpperCase();
  return mapped === (code === "BP" ? "BUSINESS_PARCEL" : code);
}

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
export const BARCODE_ALLOTMENT_DIGITS = 9;
export const BARCODE_ARTICLE_LENGTH = 13;
const PREFIX_PATTERN = /^[A-Z]{2}$/;
const SUFFIX_PATTERN = /^[A-Z]{2}$/;
const S10_ARTICLE = /^[A-Z]{2}[0-9]{9}[A-Z]{2}$/;
const MAX_NUMBER = 10 ** BARCODE_SERIAL_DIGITS - 1;
const S10_WEIGHTS = [8, 6, 4, 2, 3, 5, 9, 7];

/** Start/end fields accept digits only: 8-digit serial or 9-digit allotment (serial + check digit). */
export function sanitizeBarcodeAllotmentField(value: string) {
  return value.replace(/\D/g, "").slice(0, BARCODE_ALLOTMENT_DIGITS);
}

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

/** Nine-digit allotment India Post prints: 8-digit serial plus check digit. */
export function formatAllotmentNumber(serialNumber: number) {
  const serial = String(serialNumber).padStart(BARCODE_SERIAL_DIGITS, "0");
  return `${serial}${indiaPostS10CheckDigit(serial)}`;
}

/** Start/end fields show the same serial stored in barcode_ranges. */
export function formatStoredSerial(serialNumber: number) {
  return String(serialNumber);
}

/**
 * An allotment is the 8-digit serial or the 9-digit number India Post prints
 * (serial plus check digit). The stored value is always the 8-digit serial.
 */
function serialFromAllotment(name: string, raw: number | string) {
  const text = String(raw ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!text) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `${name} must be a whole number above zero.`);
  }

  if (!/^\d+$/.test(text)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `${name} must be a whole number above zero.`);
  }
  if (text.length > BARCODE_ALLOTMENT_DIGITS) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `${name} cannot be longer than ${BARCODE_ALLOTMENT_DIGITS} digits.`
    );
  }

  if (text.length === BARCODE_ALLOTMENT_DIGITS) {
    return serialFromNineDigitAllotment(name, text);
  }

  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > MAX_NUMBER) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `${name} must be a whole number above zero.`);
  }
  return value;
}

function serialFromNineDigitAllotment(name: string, text: string) {
  const serialDigits = text.slice(0, BARCODE_SERIAL_DIGITS);
  const expected = indiaPostS10CheckDigit(serialDigits);
  if (Number(text[BARCODE_SERIAL_DIGITS]) !== expected) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `${name} check digit does not match. The last digit should be ${expected}.`
    );
  }
  const serial = Number(serialDigits);
  if (serial < 1) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `${name} must be a whole number above zero.`);
  }
  return serial;
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

  const startNumber = serialFromAllotment("Start number", input.startNumber);
  const endNumber = serialFromAllotment("End number", input.endNumber);

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
    serviceCode: indiaPostServiceForBarcodePrefix(prefix) ?? (input.serviceCode?.trim() || null),
  };
}

/**
 * Keep next_number only when the saved series is the same allotment (or an extension).
 * A new CL block with lower serials must start at the new start, not inherit the old next.
 */
export function nextSerialForSavedRange(
  parsed: Pick<BarcodeRange, "prefix" | "suffix" | "startNumber" | "endNumber">,
  current: {
    prefix?: string | null;
    suffix?: string | null;
    next_number?: number | null;
  } | null,
  requestedNext?: number
) {
  let nextNumber = Number.isInteger(requestedNext) ? Number(requestedNext) : parsed.startNumber;
  const previousNext = Number(current?.next_number);
  if (
    current &&
    current.prefix === parsed.prefix &&
    current.suffix === parsed.suffix &&
    Number.isInteger(previousNext) &&
    previousNext >= parsed.startNumber &&
    previousNext <= parsed.endNumber + 1
  ) {
    nextNumber = Math.min(Math.max(previousNext, parsed.startNumber), parsed.endNumber + 1);
  }
  return nextNumber;
}

export type BarcodeStock = {
  prefix?: string | null;
  suffix?: string | null;
  startNumber?: number;
  endNumber?: number;
  nextNumber?: number;
  serviceCode?: string | null;
};

/** Unused articles in an allotted series, including the next number still available. */
export function barcodesLeft(range: Pick<BarcodeStock, "endNumber" | "nextNumber"> | null | undefined) {
  if (!range) return null;
  const end = Number(range.endNumber);
  const next = Number(range.nextNumber);
  if (!Number.isInteger(end) || !Number.isInteger(next)) return null;
  return Math.max(0, end - next + 1);
}

/** A service uses its own series when one is saved, otherwise the shared series. */
export function barcodeStockForService(
  ranges: readonly BarcodeStock[] | null | undefined,
  serviceCode: string
) {
  const list = ranges ?? [];
  return (
    list.find((range) => range.serviceCode === serviceCode) ??
    list.find((range) => !range.serviceCode) ??
    null
  );
}

/** Serials from the CEPT UAT document. Prefix ET or CL still must not be used on production. */
export function isCeptUatTestSeries(prefix: string, startNumber: number, endNumber: number) {
  void prefix;
  return startNumber === 21433001 && endNumber === 21434000;
}

export function normalizeIndiaPostArticleId(value?: unknown) {
  const article = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  return S10_ARTICLE.test(article) ? article : "";
}

export function isValidIndiaPostS10(value?: unknown) {
  const article = normalizeIndiaPostArticleId(value);
  if (!article) return false;
  const serial = article.slice(2, 10);
  return indiaPostS10CheckDigit(serial) === Number(article[10]);
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

/** Prefer the Any-service series; if none, show the first remaining active series. */
export function primaryActiveBarcodeRange<
  T extends { service_code?: string | null; serviceCode?: string | null },
>(ranges: T[]): T | null {
  if (!ranges.length) return null;
  return (
    ranges.find((item) => (item.service_code ?? item.serviceCode ?? null) == null) ?? ranges[0] ?? null
  );
}

export function indiaPostPublicTrackingUrl(articleId: string) {
  const article = normalizeIndiaPostArticleId(articleId) || articleId.trim().toUpperCase();
  return `https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?articleid=${encodeURIComponent(article)}`;
}
