import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { roundMoney, type SettledOrderPayment } from "@/modules/orders/payment";
import type { PaymentStatus } from "@/types/domain";

/**
 * India Post `value_for_codr_cod` is Numeric(10,2): 99,999,999.99.
 * orders.cod_amount and extra_cod_charge are numeric(12,2), which is wider.
 * The booking field is the tighter limit once an extra charge is applied.
 */
export const INDIA_POST_COD_MAX_RUPEES = 99_999_999.99;
const INDIA_POST_COD_MAX_PAISE = 9_999_999_999;
const MONEY_SCALE = 100;

export type ManualCodSettlement = SettledOrderPayment & {
  extraCodCharge: number;
};

export type SavedCodBreakdown = {
  baseOrderAmount: number;
  extraCodCharge: number;
  finalCodAmount: number;
};

function invalid(message: string): never {
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, message);
}

function toPaise(value: number) {
  if (!Number.isFinite(value)) invalid("Enter a valid extra COD charge.");
  const paise = Math.round((value + Number.EPSILON) * MONEY_SCALE);
  if (!Number.isFinite(paise)) invalid("Enter a valid extra COD charge.");
  if (Math.abs(value * MONEY_SCALE - paise) > 0.001 * MONEY_SCALE) {
    invalid("Extra COD charge supports up to 2 decimal places.");
  }
  if (paise < 0) invalid("Extra COD charge cannot be negative.");
  if (paise > INDIA_POST_COD_MAX_PAISE) {
    invalid("Extra COD charge exceeds the India Post collection limit.");
  }
  return paise;
}

function fromPaise(paise: number) {
  return paise / MONEY_SCALE;
}

/** Merchant-entered extra COD charge. Empty input is zero. Prepaid callers should not use this. */
export function parseExtraCodCharge(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return 0;
    if (/^\d+\.\d{3,}$/.test(text)) {
      invalid("Extra COD charge supports up to 2 decimal places.");
    }
    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      invalid("Enter a valid extra COD charge.");
    }
    return fromPaise(toPaise(Number(text)));
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid("Enter a valid extra COD charge.");
    return fromPaise(toPaise(value));
  }
  invalid("Enter a valid extra COD charge.");
}

export function tryParseExtraCodCharge(value: unknown): { ok: true; amount: number } | { ok: false; message: string } {
  try {
    return { ok: true, amount: parseExtraCodCharge(value) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Enter a valid extra COD charge.",
    };
  }
}

export function addRupees(left: number, right: number) {
  return fromPaise(toPaise(roundMoney(left)) + toPaise(roundMoney(right)));
}

/**
 * Adds the extra charge once, on top of the existing collect-on-delivery amount.
 * Product subtotal, discounts, and India Post tariff are left untouched.
 * A non-COD request drops any submitted charge so a stale form cannot apply it.
 */
export function applyManualExtraCodCharge(input: {
  requestedPaymentStatus?: PaymentStatus | null;
  settled: SettledOrderPayment;
  extraCodCharge?: unknown;
}): ManualCodSettlement {
  if (input.requestedPaymentStatus !== "COD") {
    return { ...input.settled, extraCodCharge: 0 };
  }

  const extra = parseExtraCodCharge(input.extraCodCharge);
  if (extra === 0) return { ...input.settled, extraCodCharge: 0 };

  if (!(input.settled.codAmount > 0)) {
    invalid("Extra COD charge applies only when cash is collected on delivery.");
  }

  const finalPaise = toPaise(input.settled.codAmount) + toPaise(extra);
  if (finalPaise > INDIA_POST_COD_MAX_PAISE) {
    invalid("Final COD amount exceeds the India Post collection limit.");
  }

  return {
    ...input.settled,
    codAmount: fromPaise(finalPaise),
    extraCodCharge: extra,
  };
}

/** Reads the saved breakdown. Does not recompute or add the extra charge again. */
export function savedOrderCodBreakdown(order: {
  total_amount?: number | string | null;
  totalAmount?: number | string | null;
  amount_paid?: number | string | null;
  amountPaid?: number | string | null;
  cod_amount?: number | string | null;
  codAmount?: number | string | null;
  extra_cod_charge?: number | string | null;
  extraCodCharge?: number | string | null;
}): SavedCodBreakdown {
  const baseOrderAmount = roundMoney(Number(order.total_amount ?? order.totalAmount ?? 0) || 0);
  const extraRaw = order.extra_cod_charge ?? order.extraCodCharge;
  const extraCodCharge =
    extraRaw == null || extraRaw === "" || !Number.isFinite(Number(extraRaw)) ? 0 : roundMoney(Number(extraRaw));
  const storedCod = order.cod_amount ?? order.codAmount;
  const paid = roundMoney(Number(order.amount_paid ?? order.amountPaid ?? 0) || 0);
  const storedNumber = storedCod == null || storedCod === "" ? null : Number(storedCod);
  const finalCodAmount =
    storedNumber != null && Number.isFinite(storedNumber) && storedNumber > 0
      ? roundMoney(storedNumber)
      : roundMoney(Math.max(0, baseOrderAmount - paid));
  return { baseOrderAmount, extraCodCharge, finalCodAmount };
}
