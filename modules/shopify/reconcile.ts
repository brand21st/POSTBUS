import {
  classifyShopifyRemotePayment,
  collectModeFromPaymentStatus,
  type ShopifyPaymentOverride,
  type ShopifyPaymentRemote,
} from "@/modules/shopify/payment";

export type ReconcileCategory =
  | "CONFIRMED_PAID_MISMATCH"
  | "CONFIRMED_COD_MISMATCH"
  | "GENUINE_PENDING"
  | "INSUFFICIENT_EVIDENCE"
  | "OTHER_PAYMENT_STATE";

export type ShipmentRiskCategory =
  | "CONFIRMED_COD_BOOKED_PREPAID"
  | "CONFIRMED_VALID_PREPAID"
  | "UNBOOKED_REQUIRES_REVIEW"
  | "INSUFFICIENT_EVIDENCE";

export type PendingOrderRow = {
  id: string;
  payment_status: string;
  source_order_id: string | null;
  shopify?: ShopifyPaymentRemote | null;
};

export type PendingShipmentRow = {
  shipmentId: string;
  shipmentStatus: string;
  paymentMode: string;
  bookedAt: string | null;
  hasAwb: boolean;
  orderPaymentStatus: string;
  merchantOverride?: ShopifyPaymentOverride | null;
  shopify?: ShopifyPaymentRemote | null;
};

function isBookedPrepaid(row: PendingShipmentRow) {
  return row.paymentMode === "PREPAID" && Boolean(row.bookedAt || row.hasAwb);
}

export function categorizePendingShopifyOrder(row: PendingOrderRow): ReconcileCategory {
  if (!row.shopify) return "INSUFFICIENT_EVIDENCE";
  const classified = classifyShopifyRemotePayment(row.shopify);
  if (classified.paymentStatus === "PAID" && row.payment_status === "PENDING") return "CONFIRMED_PAID_MISMATCH";
  if (classified.paymentStatus === "COD" && row.payment_status === "PENDING") return "CONFIRMED_COD_MISMATCH";
  if (classified.paymentStatus === "PENDING") {
    return classified.snapshot.reason === "insufficient_evidence" ? "INSUFFICIENT_EVIDENCE" : "GENUINE_PENDING";
  }
  return "OTHER_PAYMENT_STATE";
}

export function categorizePrepaidShipmentRisk(row: PendingShipmentRow): ShipmentRiskCategory {
  if (row.paymentMode !== "PREPAID") return "INSUFFICIENT_EVIDENCE";
  if (!row.bookedAt && !row.hasAwb) return "UNBOOKED_REQUIRES_REVIEW";
  if (!isBookedPrepaid(row)) return "INSUFFICIENT_EVIDENCE";

  const classified = row.shopify ? classifyShopifyRemotePayment(row.shopify) : null;
  if (classified?.paymentStatus === "COD") return "CONFIRMED_COD_BOOKED_PREPAID";
  if (classified && collectModeFromPaymentStatus(classified.paymentStatus) === "PREPAID") {
    return "CONFIRMED_VALID_PREPAID";
  }
  // Merchant prepaid confirm is collection-mode authorization, not captured-payment proof.
  return "INSUFFICIENT_EVIDENCE";
}

export function tally<T extends string>(values: T[]) {
  const counts = {} as Record<T, number>;
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}
