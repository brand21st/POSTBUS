import type { PaymentStatus } from "@/types/domain";
import { settleOrderPayment, type SettledOrderPayment } from "@/modules/orders/payment";

const COD_GATEWAY = /cash[_\s-]*on[_\s-]*delivery|\bcod\b/i;
const PAID_TRANSACTION_KIND = /^(sale|capture)$/i;
const SUCCESS_TRANSACTION_STATUS = /^(success|completed)$/i;

export type ShopifyPaymentTransaction = {
  kind?: string | null;
  status?: string | null;
  amount?: string | number | null;
  gateway?: string | null;
};

export type ShopifyPaymentOverride = {
  kind: "PREPAID" | "COD";
  actorId?: string | null;
  at: string;
};

export type ShopifyCollectionMode = "PREPAID" | "COD";

export type ShopifyBookingConflict = {
  shipmentId: string;
  bookedPaymentMode: ShopifyCollectionMode;
  classifiedCollectMode: ShopifyCollectionMode;
  at: string;
};

export type ShopifyPaymentSnapshot = {
  financialStatus: string | null;
  gateways: string[];
  sourceName: string | null;
  outstanding: number | null;
  updatedAt: string | null;
  reason: string;
  collectionMode?: ShopifyCollectionMode | null;
  override?: ShopifyPaymentOverride | null;
  bookingConflict?: ShopifyBookingConflict | null;
};

export type ShopifyPaymentRemote = {
  id?: number | string;
  financial_status?: string | null;
  displayFinancialStatus?: string | null;
  payment_gateway_names?: string[] | null;
  paymentGatewayNames?: string[] | null;
  gateway?: string | null;
  source_name?: string | null;
  sourceName?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
  total_price?: string | number | null;
  total_outstanding?: string | number | null;
  totalOutstandingSet?: { shop_money?: { amount?: string | number | null } } | null;
  transactions?: ShopifyPaymentTransaction[] | null;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function money(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function shopifyNumericId(id: number | string) {
  const raw = String(id).trim();
  const fromGid = raw.match(/\/(\d+)\s*$/);
  const value = fromGid ? Number(fromGid[1]) : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function isShopifyCodGateway(gateways?: string[] | string | null) {
  const list = Array.isArray(gateways) ? gateways : gateways ? [gateways] : [];
  return list.some((gateway) => COD_GATEWAY.test(gateway) && !/^manual$/i.test(gateway.trim()));
}

export function shopifyPaymentGateways(remote: ShopifyPaymentRemote): string[] {
  const names = remote.payment_gateway_names ?? remote.paymentGatewayNames;
  const list = Array.isArray(names) ? names : names ? [names] : [];
  const gateway = text(remote.gateway);
  const transactionGateways = (remote.transactions ?? [])
    .map((row) => text(row.gateway))
    .filter((value): value is string => Boolean(value));
  const merged = [
    ...list.map((item) => String(item)),
    ...(gateway ? [gateway] : []),
    ...transactionGateways,
  ];
  return [...new Set(merged.map((item) => item.trim()).filter(Boolean))];
}

export function shopifyFinancialStatus(remote: ShopifyPaymentRemote): string | null {
  const value =
    text(remote.financial_status) ??
    text(remote.displayFinancialStatus) ??
    text((remote as { display_financial_status?: string }).display_financial_status);
  return value ? value.toLowerCase() : null;
}

export function shopifyOutstandingAmount(remote: ShopifyPaymentRemote): number | null {
  const direct = money(remote.total_outstanding);
  if (direct != null) return direct;
  return money(remote.totalOutstandingSet?.shop_money?.amount);
}

export function shopifyHasSuccessfulPaymentTransaction(
  transactions: ShopifyPaymentTransaction[] | null | undefined,
  totalPrice?: string | number | null
): boolean {
  const rows = transactions ?? [];
  const captured = rows.filter(
    (row) =>
      PAID_TRANSACTION_KIND.test(String(row.kind ?? "")) &&
      SUCCESS_TRANSACTION_STATUS.test(String(row.status ?? ""))
  );
  if (!captured.length) return false;
  const total = money(totalPrice);
  if (total == null || total <= 0) return true;
  const paid = captured.reduce((sum, row) => sum + (money(row.amount) ?? 0), 0);
  return paid + 0.009 >= total;
}

export function normalizeShopifyPaymentFields<T extends ShopifyPaymentRemote>(remote: T): T {
  const financial = shopifyFinancialStatus(remote);
  const gateways = shopifyPaymentGateways(remote);
  const outstanding = shopifyOutstandingAmount(remote);
  const sourceName = text(remote.source_name) ?? text(remote.sourceName);
  const updatedAt = text(remote.updated_at) ?? text(remote.updatedAt);
  const numericId = remote.id != null ? shopifyNumericId(remote.id) : null;
  return {
    ...remote,
    id: numericId ?? remote.id,
    financial_status: financial ?? remote.financial_status ?? null,
    payment_gateway_names: gateways.length ? gateways : remote.payment_gateway_names ?? null,
    gateway: gateways[0] ?? remote.gateway ?? null,
    source_name: sourceName ?? remote.source_name ?? null,
    updated_at: updatedAt ?? remote.updated_at ?? null,
    total_outstanding: outstanding ?? remote.total_outstanding ?? null,
  };
}

export function mapShopifyPaymentStatus(
  value?: string | null,
  gateways?: string[] | string | null,
  evidence?: { transactions?: ShopifyPaymentTransaction[] | null; totalPrice?: string | number | null }
): PaymentStatus {
  switch ((value || "").toLowerCase()) {
    case "paid":
      return "PAID";
    case "partially_paid":
      return "PARTIAL";
    case "refunded":
    case "partially_refunded":
      return "REFUNDED";
    case "voided":
      return "FAILED";
    case "pending":
    case "authorized":
    default:
      if (shopifyHasSuccessfulPaymentTransaction(evidence?.transactions, evidence?.totalPrice)) {
        return "PAID";
      }
      if (isShopifyCodGateway(gateways)) return "COD";
      return "PENDING";
  }
}

export function classificationReason(
  status: PaymentStatus,
  financial: string | null,
  gateways: string[],
  paidByTransaction: boolean
) {
  if (status === "PAID" && paidByTransaction && financial !== "paid") return "successful_transaction";
  if (status === "COD") return "cod_gateway";
  if (financial) return `financial_status:${financial}`;
  if (!gateways.length) return "insufficient_evidence";
  return "unpaid_non_cod";
}

export function classifyShopifyRemotePayment(
  remote: ShopifyPaymentRemote,
  override?: ShopifyPaymentOverride | null
): { paymentStatus: PaymentStatus; collect: SettledOrderPayment; snapshot: ShopifyPaymentSnapshot } {
  const normalized = normalizeShopifyPaymentFields(remote);
  const financial = shopifyFinancialStatus(normalized);
  const gateways = shopifyPaymentGateways(normalized);
  const paidByTransaction = shopifyHasSuccessfulPaymentTransaction(
    normalized.transactions,
    normalized.total_price
  );
  let paymentStatus = mapShopifyPaymentStatus(financial, gateways, {
    transactions: normalized.transactions,
    totalPrice: normalized.total_price,
  });
  let reason = classificationReason(paymentStatus, financial, gateways, paidByTransaction);
  const overrideApplies =
    Boolean(override) &&
    paymentStatus === "PENDING" &&
    (financial === "pending" || financial === "authorized" || !financial);
  if (override && overrideApplies) {
    paymentStatus = override.kind === "COD" ? "COD" : "PAID";
    reason = `merchant_override:${override.kind.toLowerCase()}`;
  }
  const collect = mapShopifyCollectable(normalized, paymentStatus);
  return {
    paymentStatus: collect.paymentStatus,
    collect,
    snapshot: {
      financialStatus: financial,
      gateways,
      sourceName: text(normalized.source_name),
      outstanding: shopifyOutstandingAmount(normalized),
      updatedAt: text(normalized.updated_at),
      reason,
      collectionMode: collectModeFromPaymentStatus(collect.paymentStatus),
      override: override ?? null,
    },
  };
}

export function collectModeFromPaymentStatus(status: PaymentStatus): ShopifyCollectionMode | null {
  if (status === "COD" || status === "PARTIAL") return "COD";
  if (status === "PAID") return "PREPAID";
  return null;
}

export function bookedShipmentCollectConflict(
  bookedPaymentMode: string | null | undefined,
  classifiedStatus: PaymentStatus
): boolean {
  const classified = collectModeFromPaymentStatus(classifiedStatus);
  const booked = String(bookedPaymentMode ?? "").toUpperCase();
  if (!classified || (booked !== "COD" && booked !== "PREPAID")) return false;
  return booked !== classified;
}

export function mapShopifyCollectable(
  remote: Pick<ShopifyPaymentRemote, "total_price" | "total_outstanding" | "totalOutstandingSet">,
  paymentStatus: PaymentStatus
) {
  const total = Number(remote.total_price ?? 0);
  if (paymentStatus === "PARTIAL") {
    const outstanding = shopifyOutstandingAmount(remote);
    const amountPaid =
      outstanding == null || Number.isNaN(outstanding) ? 0 : Math.max(0, total - outstanding);
    return settleOrderPayment({
      paymentStatus: "PARTIAL",
      totalAmount: total,
      amountPaid,
      strict: false,
    });
  }
  return settleOrderPayment({
    paymentStatus,
    totalAmount: total,
    strict: false,
  });
}

export function mergeShopifyPaymentMetadata(
  metadata: unknown,
  snapshot: ShopifyPaymentSnapshot
): Record<string, unknown> {
  const current =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  current.shopifyPayment = snapshot;
  return current;
}

export function shopifyPaymentSnapshotFromMetadata(metadata: unknown): ShopifyPaymentSnapshot | null {
  if (!metadata || typeof metadata !== "object") return null;
  const row = (metadata as { shopifyPayment?: ShopifyPaymentSnapshot }).shopifyPayment;
  if (!row || typeof row !== "object") return null;
  return row;
}

export function isShopifyPaymentPayloadStale(incomingUpdatedAt?: string | null, storedUpdatedAt?: string | null) {
  if (!incomingUpdatedAt || !storedUpdatedAt) return false;
  const incoming = Date.parse(incomingUpdatedAt);
  const stored = Date.parse(storedUpdatedAt);
  if (!Number.isFinite(incoming) || !Number.isFinite(stored)) return false;
  return incoming < stored;
}

export function shopifyPaymentNeedsRefresh(remote: ShopifyPaymentRemote) {
  const financial = shopifyFinancialStatus(normalizeShopifyPaymentFields(remote));
  return !financial || financial === "pending" || financial === "authorized";
}

export function applyShopifyPaymentOverrideStatus(kind: "PREPAID" | "COD"): PaymentStatus {
  return kind === "COD" ? "COD" : "PAID";
}
