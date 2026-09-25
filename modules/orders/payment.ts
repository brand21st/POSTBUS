import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { PaymentStatus } from "@/types/domain";

export function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function money(value: number | string | null | undefined) {
  const amount = typeof value === "string" ? Number(value) : value;
  if (amount == null || Number.isNaN(amount)) return 0;
  return roundMoney(amount);
}

export type SettledOrderPayment = {
  paymentStatus: PaymentStatus;
  amountPaid: number;
  codAmount: number;
};

export function settleOrderPayment(input: {
  paymentStatus?: PaymentStatus | null;
  totalAmount: number;
  amountPaid?: number | null;
  strict?: boolean;
}): SettledOrderPayment {
  const total = Math.max(0, money(input.totalAmount));
  const status = input.paymentStatus ?? "PENDING";
  const paidIn = input.amountPaid == null || Number.isNaN(Number(input.amountPaid))
    ? null
    : money(input.amountPaid);

  if (status === "PAID") {
    return { paymentStatus: "PAID", amountPaid: total, codAmount: 0 };
  }

  if (status === "COD") {
    if (paidIn != null && paidIn > 0 && paidIn < total) {
      return {
        paymentStatus: "PARTIAL",
        amountPaid: paidIn,
        codAmount: roundMoney(total - paidIn),
      };
    }
    return { paymentStatus: "COD", amountPaid: 0, codAmount: total };
  }

  if (status === "PARTIAL") {
    const paid = paidIn ?? 0;
    if (input.strict !== false && paid <= 0) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        "Enter how much the customer already paid."
      );
    }
    if (paid >= total && total > 0) {
      return { paymentStatus: "PAID", amountPaid: total, codAmount: 0 };
    }
    if (paid <= 0) {
      return { paymentStatus: "PARTIAL", amountPaid: 0, codAmount: 0 };
    }
    return {
      paymentStatus: "PARTIAL",
      amountPaid: paid,
      codAmount: roundMoney(total - paid),
    };
  }

  return { paymentStatus: status, amountPaid: Math.max(0, paidIn ?? 0), codAmount: 0 };
}

export function shipmentCollectFromOrder(order: {
  payment_status?: string | null;
  paymentStatus?: string | null;
  total_amount?: number | string | null;
  totalAmount?: number | string | null;
  amount_paid?: number | string | null;
  amountPaid?: number | string | null;
  cod_amount?: number | string | null;
  codAmount?: number | string | null;
}) {
  const status = String(order.payment_status ?? order.paymentStatus ?? "").toUpperCase();
  const total = money(order.total_amount ?? order.totalAmount);
  const storedCod = money(order.cod_amount ?? order.codAmount);
  const paid = money(order.amount_paid ?? order.amountPaid);

  if (status === "COD") {
    return { payment_mode: "COD" as const, cod_amount: storedCod > 0 ? storedCod : total };
  }

  if (status === "PARTIAL") {
    const collect = storedCod > 0 ? storedCod : roundMoney(Math.max(0, total - paid));
    if (collect > 0) return { payment_mode: "COD" as const, cod_amount: collect };
  }

  return { payment_mode: "PREPAID" as const, cod_amount: 0 };
}
