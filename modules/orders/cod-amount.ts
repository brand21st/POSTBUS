import { classifyShopifyRemotePayment, shopifyPaymentSnapshotFromMetadata } from "@/modules/shopify/payment";
import { mapWooPayment } from "@/modules/woocommerce/payment";
import { roundMoney, settleOrderPayment, type SettledOrderPayment } from "@/modules/orders/payment";
import type { PaymentStatus } from "@/types/domain";

export function paymentStatusFromManualCod(amountPaid: number, codAmount: number): PaymentStatus {
  if (codAmount <= 0) return "PAID";
  if (amountPaid > 0) return "PARTIAL";
  return "COD";
}

function wooSnapshot(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const woo = (metadata as { woocommerce?: { paymentMethod?: string | null; status?: string | null } }).woocommerce;
  if (!woo || typeof woo !== "object") return null;
  if (!woo.paymentMethod && !woo.status) return null;
  return woo;
}

/** AUTO restore: store snapshot when we have one, otherwise the saved total and amount received. */
export function restoreAutoOrderPayment(order: {
  source?: string | null;
  total_amount?: number | string | null;
  totalAmount?: number | string | null;
  amount_paid?: number | string | null;
  amountPaid?: number | string | null;
  payment_status?: string | null;
  paymentStatus?: string | null;
  metadata?: unknown;
}): SettledOrderPayment {
  const source = String(order.source ?? "").toUpperCase();
  const total = roundMoney(Number(order.total_amount ?? order.totalAmount ?? 0) || 0);

  if (source === "SHOPIFY") {
    const snapshot = shopifyPaymentSnapshotFromMetadata(order.metadata);
    if (snapshot) {
      const current = snapshot.currentTotal ?? total;
      return classifyShopifyRemotePayment(
        {
          financial_status: snapshot.financialStatus,
          payment_gateway_names: snapshot.gateways,
          source_name: snapshot.sourceName,
          total_price: snapshot.originalTotal ?? current,
          current_total_price: snapshot.currentTotal ?? total,
          total_outstanding: snapshot.outstanding,
        },
        snapshot.override ?? null
      ).collect;
    }
  }

  if (source === "WOOCOMMERCE") {
    const woo = wooSnapshot(order.metadata);
    if (woo) {
      return mapWooPayment({
        paymentMethod: woo.paymentMethod,
        total,
        status: woo.status,
      });
    }
  }

  const status = String(order.payment_status ?? order.paymentStatus ?? "PENDING").toUpperCase() as PaymentStatus;
  return settleOrderPayment({
    paymentStatus: status,
    totalAmount: total,
    amountPaid: Number(order.amount_paid ?? order.amountPaid ?? 0),
    strict: false,
  });
}
