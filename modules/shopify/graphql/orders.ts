import type { ShopifyPaymentTransaction } from "@/modules/shopify/payment";
import type { ShopifyRemoteLineItem, ShopifyRemoteOrder } from "@/modules/shopify/orders";
import { shopifyAdminGraphql, type ShopifyGraphqlDeps } from "@/modules/shopify/graphql/client";

/**
 * GraphQL-only order reads for the public App Store app, mapped into the same ShopifyRemoteOrder
 * shape the REST/webhook importer uses, so upsertShopifyOrder stays the single write path.
 *
 * Cost budget: Shopify caps a query at 1000 points and charges by `first`, so pages are 8 orders with
 * 10 inline line items (~900 points). Larger orders page their remaining line items separately.
 */
export const APP_ORDERS_PAGE_SIZE = 8;
const INLINE_LINE_ITEMS = 10;
const LINE_ITEM_PAGE = 50;

const MONEY = "shopMoney { amount }";
const ADDRESS = "name firstName lastName company address1 address2 city province provinceCode zip country countryCodeV2 phone";

const LINE_ITEM_FIELDS = `
  id title name variantTitle sku quantity currentQuantity unfulfilledQuantity requiresShipping
  originalUnitPriceSet { ${MONEY} }
  discountedUnitPriceSet { ${MONEY} }
  image { url }
  variant {
    legacyResourceId
    image { url }
    inventoryItem { measurement { weight { value unit } } }
  }
`;

const ORDER_FIELDS = `
  id legacyResourceId name email phone cancelledAt updatedAt edited
  displayFinancialStatus displayFulfillmentStatus
  currencyCode sourceName tags paymentGatewayNames
  subtotalPriceSet { ${MONEY} }
  currentSubtotalPriceSet { ${MONEY} }
  totalDiscountsSet { ${MONEY} }
  totalShippingPriceSet { ${MONEY} }
  totalTaxSet { ${MONEY} }
  currentTotalTaxSet { ${MONEY} }
  totalPriceSet { ${MONEY} }
  currentTotalPriceSet { ${MONEY} }
  totalOutstandingSet { ${MONEY} }
  shippingAddress { ${ADDRESS} }
  billingAddress { ${ADDRESS} }
  customer { firstName lastName email phone }
  transactions(first: 5) { kind status gateway amountSet { ${MONEY} } }
  lineItems(first: ${INLINE_LINE_ITEMS}) {
    pageInfo { hasNextPage endCursor }
    nodes { ${LINE_ITEM_FIELDS} }
  }
`;

const ORDERS_PAGE_QUERY = `
  query PostBusAppOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { ${ORDER_FIELDS} }
    }
  }
`;

const ORDER_QUERY = `
  query PostBusAppOrder($id: ID!) {
    order(id: $id) { ${ORDER_FIELDS} }
  }
`;

const ORDER_LINE_ITEMS_QUERY = `
  query PostBusAppOrderLineItems($id: ID!, $after: String) {
    order(id: $id) {
      lineItems(first: ${LINE_ITEM_PAGE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ${LINE_ITEM_FIELDS} }
      }
    }
  }
`;

type Money = { shopMoney?: { amount?: string | null } | null } | null;
type Address = Record<string, string | null> | null;
type PageInfo = { hasNextPage?: boolean; endCursor?: string | null };

export type GraphqlLineItem = {
  id?: string;
  title?: string | null;
  name?: string | null;
  variantTitle?: string | null;
  sku?: string | null;
  quantity?: number | null;
  currentQuantity?: number | null;
  unfulfilledQuantity?: number | null;
  requiresShipping?: boolean | null;
  originalUnitPriceSet?: Money;
  discountedUnitPriceSet?: Money;
  image?: { url?: string | null } | null;
  variant?: {
    legacyResourceId?: string | null;
    image?: { url?: string | null } | null;
    inventoryItem?: { measurement?: { weight?: { value?: number | null; unit?: string | null } | null } | null } | null;
  } | null;
};

export type GraphqlOrder = {
  id?: string;
  legacyResourceId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  cancelledAt?: string | null;
  updatedAt?: string | null;
  edited?: boolean | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  currencyCode?: string | null;
  sourceName?: string | null;
  tags?: string[] | null;
  paymentGatewayNames?: string[] | null;
  subtotalPriceSet?: Money;
  currentSubtotalPriceSet?: Money;
  totalDiscountsSet?: Money;
  totalShippingPriceSet?: Money;
  totalTaxSet?: Money;
  currentTotalTaxSet?: Money;
  totalPriceSet?: Money;
  currentTotalPriceSet?: Money;
  totalOutstandingSet?: Money;
  shippingAddress?: Address;
  billingAddress?: Address;
  customer?: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null } | null;
  transactions?: Array<{ kind?: string | null; status?: string | null; gateway?: string | null; amountSet?: Money }> | null;
  lineItems?: { pageInfo?: PageInfo; nodes?: GraphqlLineItem[] } | null;
};

const amount = (money?: Money) => money?.shopMoney?.amount ?? null;
const lower = (value?: string | null) => (value ? value.toLowerCase() : null);

/** REST-shaped fulfillment_status the importer and eligibility evaluator understand. */
export function restFulfillmentStatus(value?: string | null) {
  switch ((value || "").toUpperCase()) {
    case "FULFILLED":
      return "fulfilled";
    case "PARTIALLY_FULFILLED":
      return "partial";
    case "UNFULFILLED":
    case "OPEN":
    case "RESTOCKED":
      return "unfulfilled";
    case "ON_HOLD":
      return "on_hold";
    case "SCHEDULED":
      return "scheduled";
    case "IN_PROGRESS":
    case "PENDING_FULFILLMENT":
      return "in_progress";
    case "REQUEST_DECLINED":
      return "request_declined";
    case "":
      return null;
    default:
      return "unknown";
  }
}

/** GraphQL MailingAddress → REST address keys the importer reads. */
export function restAddress(address: Address): Record<string, string | null> | null {
  if (!address) return null;
  return {
    name: address.name ?? null,
    first_name: address.firstName ?? null,
    last_name: address.lastName ?? null,
    company: address.company ?? null,
    address1: address.address1 ?? null,
    address2: address.address2 ?? null,
    city: address.city ?? null,
    province: address.province ?? null,
    province_code: address.provinceCode ?? null,
    zip: address.zip ?? null,
    country: address.country ?? null,
    country_code: address.countryCodeV2 ?? null,
    phone: address.phone ?? null,
  };
}

export function mapGraphqlLineItem(node: GraphqlLineItem): ShopifyRemoteLineItem {
  const weight = node.variant?.inventoryItem?.measurement?.weight;
  const image = node.image?.url || node.variant?.image?.url || null;
  const remaining = node.unfulfilledQuantity;
  return {
    id: node.id ?? null,
    title: node.title ?? undefined,
    name: node.name ?? null,
    variant_title: node.variantTitle ?? null,
    sku: node.sku ?? null,
    quantity: node.quantity ?? 1,
    current_quantity: node.currentQuantity ?? null,
    unfulfilled_quantity: remaining ?? null,
    fulfillable_quantity: remaining ?? null,
    requires_shipping: node.requiresShipping !== false,
    price: amount(node.discountedUnitPriceSet) ?? amount(node.originalUnitPriceSet) ?? 0,
    variant_id: node.variant?.legacyResourceId ?? null,
    image: image ? { src: image } : null,
    variant:
      weight?.value != null && weight.unit
        ? { weight: { value: weight.value, unit: weight.unit.toLowerCase() }, weight_unit: weight.unit.toLowerCase() }
        : null,
  };
}

export function mapGraphqlOrder(node: GraphqlOrder, extraLineItems: GraphqlLineItem[] = []): ShopifyRemoteOrder {
  const transactions: ShopifyPaymentTransaction[] = (node.transactions ?? []).map((transaction) => ({
    kind: lower(transaction.kind),
    status: lower(transaction.status),
    gateway: transaction.gateway ?? null,
    amount: amount(transaction.amountSet),
  }));
  const customer = node.customer
    ? {
        first_name: node.customer.firstName ?? null,
        last_name: node.customer.lastName ?? null,
        email: node.customer.email ?? null,
        phone: node.customer.phone ?? null,
      }
    : null;
  return {
    // Numeric id: matches the REST/webhook payload id used as orders.source_order_id.
    id: node.legacyResourceId ?? undefined,
    name: node.name ?? undefined,
    email: node.email ?? null,
    phone: node.phone ?? null,
    cancelled_at: node.cancelledAt ?? null,
    updated_at: node.updatedAt ?? null,
    edited: node.edited === true,
    financial_status: lower(node.displayFinancialStatus),
    displayFulfillmentStatus: node.displayFulfillmentStatus ?? null,
    fulfillment_status: restFulfillmentStatus(node.displayFulfillmentStatus),
    currency: node.currencyCode ?? null,
    source_name: node.sourceName ?? null,
    tags: node.tags ?? null,
    payment_gateway_names: node.paymentGatewayNames ?? null,
    subtotal_price: amount(node.subtotalPriceSet),
    current_subtotal_price: amount(node.currentSubtotalPriceSet),
    total_discounts: amount(node.totalDiscountsSet),
    total_shipping_price_set: { shop_money: { amount: amount(node.totalShippingPriceSet) ?? undefined } },
    total_tax: amount(node.currentTotalTaxSet) ?? amount(node.totalTaxSet),
    total_price: amount(node.totalPriceSet),
    current_total_price: amount(node.currentTotalPriceSet),
    total_outstanding: amount(node.totalOutstandingSet),
    shipping_address: restAddress(node.shippingAddress ?? null),
    billing_address: restAddress(node.billingAddress ?? null),
    customer,
    transactions,
    line_items: [...(node.lineItems?.nodes ?? []), ...extraLineItems].map(mapGraphqlLineItem),
  };
}

export function shopifyOrderGid(id: string | number) {
  const raw = String(id).trim();
  return raw.startsWith("gid://") ? raw : `gid://shopify/Order/${raw}`;
}

async function remainingLineItems(shop: string, token: string, order: GraphqlOrder, deps?: ShopifyGraphqlDeps) {
  const extra: GraphqlLineItem[] = [];
  let pageInfo = order.lineItems?.pageInfo;
  while (pageInfo?.hasNextPage && pageInfo.endCursor && order.id) {
    const { data } = await shopifyAdminGraphql<{
      order?: { lineItems?: { pageInfo?: PageInfo; nodes?: GraphqlLineItem[] } } | null;
    }>(shop, token, ORDER_LINE_ITEMS_QUERY, { id: order.id, after: pageInfo.endCursor }, deps);
    extra.push(...(data.order?.lineItems?.nodes ?? []));
    pageInfo = data.order?.lineItems?.pageInfo;
  }
  return extra;
}

/** Shopify search syntax for orders still waiting to ship, optionally limited to a recent window. */
export function unfulfilledOrdersSearch(sinceIso?: string | null) {
  const parts = ["status:open", "(fulfillment_status:unfulfilled OR fulfillment_status:partial)"];
  if (sinceIso) parts.push(`created_at:>='${sinceIso}'`);
  return parts.join(" AND ");
}

export async function fetchAppOrdersPage(
  shop: string,
  token: string,
  input: { after?: string | null; search: string; first?: number },
  deps?: ShopifyGraphqlDeps
) {
  const { data } = await shopifyAdminGraphql<{
    orders?: { pageInfo?: PageInfo; nodes?: GraphqlOrder[] };
  }>(
    shop,
    token,
    ORDERS_PAGE_QUERY,
    { first: input.first ?? APP_ORDERS_PAGE_SIZE, after: input.after ?? null, query: input.search },
    deps
  );
  const orders: ShopifyRemoteOrder[] = [];
  for (const node of data.orders?.nodes ?? []) {
    orders.push(mapGraphqlOrder(node, await remainingLineItems(shop, token, node, deps)));
  }
  const pageInfo = data.orders?.pageInfo;
  return {
    orders,
    nextCursor: pageInfo?.hasNextPage ? (pageInfo.endCursor ?? null) : null,
  };
}

export async function fetchAppOrder(
  shop: string,
  token: string,
  id: string | number,
  deps?: ShopifyGraphqlDeps
): Promise<ShopifyRemoteOrder | null> {
  const { data } = await shopifyAdminGraphql<{ order?: GraphqlOrder | null }>(
    shop,
    token,
    ORDER_QUERY,
    { id: shopifyOrderGid(id) },
    deps
  );
  if (!data.order) return null;
  return mapGraphqlOrder(data.order, await remainingLineItems(shop, token, data.order, deps));
}
