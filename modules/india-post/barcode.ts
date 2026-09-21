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

// India Post article numbers are 13 characters: two letters, nine digits, two letters
// (the trailing pair is the country code, IN). Anything else is rejected at booking.
export const BARCODE_DIGITS = 9;
const PREFIX_PATTERN = /^[A-Z]{2}$/;
const SUFFIX_PATTERN = /^[A-Z]{2}$/;
const MAX_NUMBER = 10 ** BARCODE_DIGITS - 1;

export function formatBarcode(prefix: string, serialNumber: number, suffix: string) {
  return `${prefix}${String(serialNumber).padStart(BARCODE_DIGITS, "0")}${suffix}`;
}

export function parseBarcodeRange(input: BarcodeRangeInput): BarcodeRange {
  const prefix = (input.prefix ?? "").trim().toUpperCase();
  const suffix = ((input.suffix ?? "IN") || "IN").trim().toUpperCase();

  if (!PREFIX_PATTERN.test(prefix)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "Barcode prefix must be the two letters India Post allotted, for example ET."
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
        `${name} cannot be longer than ${BARCODE_DIGITS} digits.`
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
