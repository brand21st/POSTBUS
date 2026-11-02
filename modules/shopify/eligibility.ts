import type { FulfillmentStatus } from "@/types/domain";

export const SHOPIFY_CREATE_FULFILLMENT_ACTION = "CREATE_FULFILLMENT";

export type ShopifyEligibilityLine = {
  id?: string | number | null;
  quantity?: number | null;
  current_quantity?: number | null;
  currentQuantity?: number | null;
  unfulfilled_quantity?: number | null;
  unfulfilledQuantity?: number | null;
  fulfillable_quantity?: number | null;
  fulfillableQuantity?: number | null;
  requires_shipping?: boolean | null;
  requiresShipping?: boolean | null;
};

export type ShopifyEligibilityFulfillmentOrderLine = {
  id: string;
  remainingQuantity: number;
  totalQuantity?: number | null;
  requiresShipping: boolean;
  orderLineItemId?: string | null;
};

export type ShopifyEligibilityFulfillmentOrder = {
  id: string;
  status?: string | null;
  requestStatus?: string | null;
  supportedActions?: string[];
  assignedLocationId?: string | null;
  lineItems: ShopifyEligibilityFulfillmentOrderLine[];
};

export type ShopifyEligibilityAllocation = {
  fulfillmentOrderLineItemId: string;
  quantity: number;
  shipmentId?: string | null;
  status?: string | null;
};

export type ShopifyEligibilityInput = {
  id?: string | number | null;
  cancelled_at?: string | null;
  cancelledAt?: string | null;
  fulfillment_status?: string | null;
  displayFulfillmentStatus?: string | null;
  line_items?: ShopifyEligibilityLine[] | null;
  fulfillmentOrders?: ShopifyEligibilityFulfillmentOrder[] | null;
};

export type ShopifyRemainingLine = {
  id: string | null;
  originalQuantity: number;
  remainingEligibleQuantity: number;
  requiresShipping: boolean;
  remainingQuantityKnown: boolean;
};

export type ShopifyBookableFulfillmentLine = {
  fulfillmentOrderId: string;
  fulfillmentOrderLineItemId: string;
  orderLineItemId: string | null;
  remainingQuantity: number;
  totalQuantity: number;
  requiresShipping: boolean;
  assignedLocationId: string | null;
};

export type ShopifyOrderEligibility = {
  eligibleForImport: boolean;
  eligibleForBooking: boolean;
  fulfillmentStatus: FulfillmentStatus;
  displayStatus: string;
  remainingLineItems: ShopifyRemainingLine[];
  remainingShippableQuantity: number;
  remainingQuantityKnown: boolean;
  exclusionReason: string | null;
  bookingBlockReason: string | null;
  bookableFulfillmentLines: ShopifyBookableFulfillmentLine[];
};

const UNFULFILLED_ALIASES = new Set(["UNFULFILLED", "OPEN", "RESTOCKED", "unfulfilled", "unshipped", "null"]);
const PARTIAL_ALIASES = new Set(["PARTIALLY_FULFILLED", "PARTIAL", "partial"]);
const HOLD_ALIASES = new Set(["ON_HOLD", "on_hold"]);
const SCHEDULED_ALIASES = new Set(["SCHEDULED", "scheduled"]);
const IN_PROGRESS_ALIASES = new Set(["IN_PROGRESS", "PENDING_FULFILLMENT", "in_progress", "pending_fulfillment"]);

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function asBool(value: unknown, fallback: boolean | null): boolean | null {
  if (value === true || value === false) return value;
  return fallback;
}

export function shopifyLineItemGid(id?: string | number | null) {
  const raw = String(id ?? "").trim();
  if (!raw) return null;
  return raw.startsWith("gid://") ? raw : `gid://shopify/LineItem/${raw}`;
}

export function shopifyFulfillmentOrderGid(id?: string | number | null) {
  const raw = String(id ?? "").trim();
  if (!raw) return null;
  return raw.startsWith("gid://") ? raw : `gid://shopify/FulfillmentOrder/${raw}`;
}

export function shopifyFulfillmentOrderLineItemGid(id?: string | number | null) {
  const raw = String(id ?? "").trim();
  if (!raw) return null;
  return raw.startsWith("gid://") ? raw : `gid://shopify/FulfillmentOrderLineItem/${raw}`;
}

export function normalizeShopifyDisplayFulfillmentStatus(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return "UNFULFILLED";
  const upper = raw.toUpperCase();
  if (upper === "FULFILLED" || upper === "SHIPPED") return "FULFILLED";
  if (PARTIAL_ALIASES.has(raw) || PARTIAL_ALIASES.has(upper)) return "PARTIALLY_FULFILLED";
  if (HOLD_ALIASES.has(raw) || HOLD_ALIASES.has(upper)) return "ON_HOLD";
  if (SCHEDULED_ALIASES.has(raw) || SCHEDULED_ALIASES.has(upper)) return "SCHEDULED";
  if (IN_PROGRESS_ALIASES.has(raw) || IN_PROGRESS_ALIASES.has(upper)) return "IN_PROGRESS";
  if (upper === "REQUEST_DECLINED") return "REQUEST_DECLINED";
  if (UNFULFILLED_ALIASES.has(raw) || UNFULFILLED_ALIASES.has(upper)) return "UNFULFILLED";
  return "UNKNOWN";
}

export function mapDisplayStatusToPostBus(displayStatus: string, cancelled: boolean): FulfillmentStatus {
  if (cancelled) return "CANCELLED";
  if (displayStatus === "FULFILLED") return "FULFILLED";
  if (displayStatus === "PARTIALLY_FULFILLED") return "PARTIAL";
  return "UNFULFILLED";
}

/**
 * Remaining shippable units for one Shopify line. Never falls back to original ordered quantity.
 * Missing remaining fields return known=false so callers can block instead of guessing.
 */
export function remainingShippableForLine(item: ShopifyEligibilityLine): ShopifyRemainingLine {
  const original = Math.max(0, asNumber(item.quantity) ?? 0);
  const id = item.id != null ? String(item.id) : null;
  const requiresShipping = asBool(item.requires_shipping ?? item.requiresShipping, true);
  const remainingRaw =
    asNumber(item.unfulfilled_quantity) ??
    asNumber(item.unfulfilledQuantity) ??
    asNumber(item.fulfillable_quantity) ??
    asNumber(item.fulfillableQuantity);
  if (requiresShipping === false) {
    return {
      id,
      originalQuantity: original,
      remainingEligibleQuantity: 0,
      requiresShipping: false,
      remainingQuantityKnown: true,
    };
  }
  if (remainingRaw == null) {
    return {
      id,
      originalQuantity: original,
      remainingEligibleQuantity: 0,
      requiresShipping: true,
      remainingQuantityKnown: false,
    };
  }
  return {
    id,
    originalQuantity: original,
    remainingEligibleQuantity: Math.max(0, remainingRaw),
    requiresShipping: true,
    remainingQuantityKnown: true,
  };
}

export function remainingQuantityFromLine(item: ShopifyEligibilityLine) {
  const remaining = remainingShippableForLine(item);
  if (!remaining.remainingQuantityKnown) return null;
  return remaining.remainingEligibleQuantity;
}

function cancelledAt(order: ShopifyEligibilityInput) {
  return Boolean(order.cancelled_at || order.cancelledAt);
}

function availableAfterAllocations(
  remaining: number,
  fulfillmentOrderLineItemId: string,
  allocations: ShopifyEligibilityAllocation[] | undefined,
  currentShipmentId?: string | null
) {
  const reserved = (allocations ?? [])
    .filter((row) => {
      if (shopifyFulfillmentOrderLineItemGid(row.fulfillmentOrderLineItemId) !== fulfillmentOrderLineItemId) {
        return false;
      }
      if (currentShipmentId && row.shipmentId === currentShipmentId) return false;
      const status = String(row.status ?? "RESERVED").toUpperCase();
      return status === "RESERVED" || status === "BOOKED";
    })
    .reduce((sum, row) => sum + Math.max(0, Number(row.quantity) || 0), 0);
  return Math.max(0, remaining - reserved);
}

export function isFulfillmentCurrentlyPermitted(order: ShopifyEligibilityFulfillmentOrder) {
  const status = String(order.status ?? "").toUpperCase();
  const request = String(order.requestStatus ?? "").toUpperCase();
  const actions = (order.supportedActions ?? []).map((action) =>
    String(action).toUpperCase().replace(/[\s-]/g, "_")
  );
  if (["ON_HOLD", "SCHEDULED", "CLOSED", "CANCELLED", "INCOMPLETE"].includes(status)) {
    return false;
  }
  if (["SUBMITTED", "ACCEPTED", "CANCELLATION_REQUESTED"].includes(request)) {
    return false;
  }
  return actions.includes(SHOPIFY_CREATE_FULFILLMENT_ACTION);
}

export function bookableFulfillmentLines(input: {
  fulfillmentOrders?: ShopifyEligibilityFulfillmentOrder[] | null;
  allocations?: ShopifyEligibilityAllocation[];
  currentShipmentId?: string | null;
}): ShopifyBookableFulfillmentLine[] {
  const lines: ShopifyBookableFulfillmentLine[] = [];
  for (const order of input.fulfillmentOrders ?? []) {
    const fulfillmentOrderId = shopifyFulfillmentOrderGid(order.id);
    if (!fulfillmentOrderId) continue;
    if (!isFulfillmentCurrentlyPermitted(order)) continue;
    for (const line of order.lineItems ?? []) {
      if (!line.requiresShipping) continue;
      const fulfillmentOrderLineItemId = shopifyFulfillmentOrderLineItemGid(line.id);
      if (!fulfillmentOrderLineItemId) continue;
      const remaining = availableAfterAllocations(
        Math.max(0, Number(line.remainingQuantity) || 0),
        fulfillmentOrderLineItemId,
        input.allocations,
        input.currentShipmentId
      );
      if (remaining <= 0) continue;
      lines.push({
        fulfillmentOrderId,
        fulfillmentOrderLineItemId,
        orderLineItemId: line.orderLineItemId ? shopifyLineItemGid(line.orderLineItemId) : null,
        remainingQuantity: remaining,
        totalQuantity: Math.max(0, Number(line.totalQuantity) || remaining),
        requiresShipping: true,
        assignedLocationId: order.assignedLocationId ?? null,
      });
    }
  }
  return lines;
}

export function evaluateShopifyOrderEligibility(
  order: ShopifyEligibilityInput,
  options?: {
    fulfillmentOrders?: ShopifyEligibilityFulfillmentOrder[] | null;
    allocations?: ShopifyEligibilityAllocation[];
    currentShipmentId?: string | null;
    fulfillmentOrdersFetched?: boolean;
  }
): ShopifyOrderEligibility {
  const cancelled = cancelledAt(order);
  const displayStatus = cancelled
    ? "CANCELLED"
    : normalizeShopifyDisplayFulfillmentStatus(order.displayFulfillmentStatus ?? order.fulfillment_status);
  const remainingLineItems = (order.line_items ?? []).map(remainingShippableForLine);
  const remainingQuantityKnown =
    remainingLineItems.length === 0
      ? false
      : remainingLineItems.every((line) => line.remainingQuantityKnown || !line.requiresShipping);
  const remainingShippableQuantity = remainingLineItems.reduce(
    (sum, line) => sum + (line.requiresShipping ? line.remainingEligibleQuantity : 0),
    0
  );
  const fulfillmentOrders = options?.fulfillmentOrders ?? order.fulfillmentOrders ?? null;
  const bookableLines = bookableFulfillmentLines({
    fulfillmentOrders,
    allocations: options?.allocations,
    currentShipmentId: options?.currentShipmentId,
  });
  const foRemaining = bookableLines.reduce((sum, line) => sum + line.remainingQuantity, 0);
  const fulfillmentOrdersFetched = Boolean(options?.fulfillmentOrdersFetched || fulfillmentOrders);
  const fulfillmentStatus = mapDisplayStatusToPostBus(displayStatus, cancelled);

  let exclusionReason: string | null = null;
  let holdReason: string | null = null;

  if (cancelled) {
    exclusionReason = "cancelled";
  } else if (displayStatus === "UNKNOWN") {
    exclusionReason = "unknown_fulfillment_status";
  } else if (displayStatus === "FULFILLED") {
    exclusionReason = "fulfilled";
  } else if (!remainingQuantityKnown && !(fulfillmentOrdersFetched && foRemaining > 0)) {
    exclusionReason = "remaining_quantity_unknown";
  } else if (remainingShippableQuantity <= 0 && !(fulfillmentOrdersFetched && foRemaining > 0)) {
    exclusionReason = "no_remaining_shippable_quantity";
  }

  if (displayStatus === "ON_HOLD") holdReason = "Shopify fulfillment is on hold.";
  else if (displayStatus === "SCHEDULED") holdReason = "Shopify fulfillment is scheduled and not yet permitted.";
  else if (displayStatus === "REQUEST_DECLINED") holdReason = "Shopify fulfillment request was declined.";

  const eligibleForImport = exclusionReason == null;

  let bookingBlockReason: string | null = holdReason;
  if (cancelled) bookingBlockReason = "Shopify order is cancelled.";
  else if (displayStatus === "UNKNOWN") {
    bookingBlockReason = "Shopify fulfillment status is unknown. Booking is blocked.";
  } else if (displayStatus === "FULFILLED") {
    bookingBlockReason = "Shopify order is already fulfilled.";
  } else if (!remainingQuantityKnown && !fulfillmentOrdersFetched) {
    bookingBlockReason = "Remaining Shopify quantity is unavailable. Fetch fulfillment orders before booking.";
  } else if (remainingShippableQuantity <= 0 && !fulfillmentOrdersFetched) {
    bookingBlockReason = "No remaining physical items require shipping.";
  }

  if (fulfillmentOrdersFetched && !holdReason && !cancelled && displayStatus !== "FULFILLED") {
    if (!fulfillmentOrders?.length) {
      bookingBlockReason =
        "Shopify fulfillment orders are inaccessible. Confirm fulfillment-order scopes and try again.";
    } else if (foRemaining <= 0) {
      bookingBlockReason = "No bookable Shopify fulfillment-order quantity remains.";
    } else {
      bookingBlockReason = null;
    }
  } else if (eligibleForImport && !bookingBlockReason) {
    bookingBlockReason = "Shopify fulfillment orders were not revalidated.";
  }

  const eligibleForBooking =
    eligibleForImport &&
    bookingBlockReason == null &&
    fulfillmentOrdersFetched &&
    foRemaining > 0;

  return {
    eligibleForImport,
    eligibleForBooking,
    fulfillmentStatus,
    displayStatus,
    remainingLineItems,
    remainingShippableQuantity: fulfillmentOrdersFetched ? foRemaining : remainingShippableQuantity,
    remainingQuantityKnown: remainingQuantityKnown || (fulfillmentOrdersFetched && foRemaining > 0),
    exclusionReason,
    bookingBlockReason,
    bookableFulfillmentLines: bookableLines,
  };
}
