import { settleOrderPayment, type SettledOrderPayment } from "@/modules/orders/payment";

export type WooPaymentInput = {
  paymentMethod?: string | null;
  paymentMethodTitle?: string | null;
  total?: string | number | null;
  refundTotal?: string | number | null;
  datePaid?: string | null;
  status?: string | null;
};

function money(value: string | number | null | undefined) {
  const amount = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function isWooCodMethod(paymentMethod?: string | null) {
  return (paymentMethod ?? "").trim().toLowerCase() === "cod";
}

/** Collectable balance after refunds. Display titles are ignored. */
export function mapWooPayment(input: WooPaymentInput): SettledOrderPayment {
  const total = Math.max(0, money(input.total));
  const refunded = Math.abs(money(input.refundTotal));
  const payable = Math.max(0, Math.round((total - refunded) * 100) / 100);
  const status = (input.status ?? "").toLowerCase();
  const cod = isWooCodMethod(input.paymentMethod);

  if (status === "refunded" || payable <= 0) {
    return settleOrderPayment({ paymentStatus: "REFUNDED", totalAmount: total, amountPaid: total });
  }

  if (cod) {
    return settleOrderPayment({
      paymentStatus: "COD",
      totalAmount: payable,
      amountPaid: 0,
    });
  }

  if (input.datePaid || status === "processing" || status === "completed") {
    return settleOrderPayment({ paymentStatus: "PAID", totalAmount: payable, amountPaid: payable });
  }

  return settleOrderPayment({ paymentStatus: "PENDING", totalAmount: payable, amountPaid: 0 });
}
