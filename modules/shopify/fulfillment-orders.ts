import { shopifyAdminGraphql, type ShopifyGraphqlDeps } from "@/modules/shopify/graphql/client";
import {
  shopifyFulfillmentOrderGid,
  shopifyFulfillmentOrderLineItemGid,
  shopifyLineItemGid,
  type ShopifyEligibilityFulfillmentOrder,
} from "@/modules/shopify/eligibility";

export const SHOPIFY_ORDER_BOOKING_FULFILLMENT_ORDERS = `
  query PostBusOrderBookingFulfillmentOrders($id: ID!) {
    order(id: $id) {
      id
      cancelledAt
      displayFulfillmentStatus
      fulfillmentOrders(first: 20) {
        nodes {
          id
          status
          requestStatus
          supportedActions { action }
          assignedLocation { location { id } }
          lineItems(first: 50) {
            nodes {
              id
              remainingQuantity
              totalQuantity
              requiresShipping
              lineItem { id }
            }
          }
        }
      }
    }
  }
`;

type GraphqlFoLine = {
  id?: string | null;
  remainingQuantity?: number | null;
  totalQuantity?: number | null;
  requiresShipping?: boolean | null;
  lineItem?: { id?: string | null } | null;
};

type GraphqlFo = {
  id?: string | null;
  status?: string | null;
  requestStatus?: string | null;
  supportedActions?: Array<{ action?: string | null } | string | null> | null;
  assignedLocation?: { location?: { id?: string | null } | null } | null;
  lineItems?: { nodes?: GraphqlFoLine[] | null } | null;
};

export type ShopifyOrderFulfillmentSnapshot = {
  orderGid: string | null;
  cancelledAt: string | null;
  displayFulfillmentStatus: string | null;
  fulfillmentOrders: ShopifyEligibilityFulfillmentOrder[];
};

function actionName(value: { action?: string | null } | string | null | undefined) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.action ?? "";
}

export function mapGraphqlFulfillmentOrders(nodes: GraphqlFo[] | null | undefined): ShopifyEligibilityFulfillmentOrder[] {
  return (nodes ?? [])
    .filter((node): node is GraphqlFo & { id: string } => Boolean(node?.id))
    .map((node) => ({
      id: node.id,
      status: node.status ?? null,
      requestStatus: node.requestStatus ?? null,
      supportedActions: (node.supportedActions ?? []).map(actionName).filter(Boolean),
      assignedLocationId: node.assignedLocation?.location?.id ?? null,
      lineItems: (node.lineItems?.nodes ?? [])
        .filter((line): line is GraphqlFoLine & { id: string } => Boolean(line?.id))
        .map((line) => ({
          id: shopifyFulfillmentOrderLineItemGid(line.id) as string,
          remainingQuantity: Number(line.remainingQuantity) || 0,
          totalQuantity: Number(line.totalQuantity) || 0,
          requiresShipping: line.requiresShipping !== false,
          orderLineItemId: shopifyLineItemGid(line.lineItem?.id ?? null),
        })),
    }));
}

export function mapRestFulfillmentOrders(payload: unknown): ShopifyEligibilityFulfillmentOrder[] {
  const record = (payload ?? {}) as { fulfillment_orders?: Array<Record<string, unknown>> };
  return (record.fulfillment_orders ?? []).map((row) => {
    const actions = Array.isArray(row.supported_actions)
      ? row.supported_actions.map((action) => String(action).toUpperCase())
      : [];
    const lines = Array.isArray(row.line_items) ? row.line_items : [];
    return {
      id: shopifyFulfillmentOrderGid(row.id as string | number) as string,
      status: String(row.status ?? ""),
      requestStatus: String(row.request_status ?? ""),
      supportedActions: actions,
      assignedLocationId: row.assigned_location_id != null ? String(row.assigned_location_id) : null,
      lineItems: lines.map((line) => {
        const item = line as Record<string, unknown>;
        return {
          id: shopifyFulfillmentOrderLineItemGid(item.id as string | number) as string,
          remainingQuantity: Number(item.remaining_quantity ?? item.fulfillable_quantity) || 0,
          totalQuantity: Number(item.quantity ?? item.total_quantity) || 0,
          requiresShipping: item.requires_shipping !== false,
          orderLineItemId: shopifyLineItemGid((item.line_item_id as string | number | null) ?? null),
        };
      }),
    };
  });
}

export async function fetchShopifyOrderFulfillmentOrders(
  shop: string,
  token: string,
  orderId: string,
  deps?: ShopifyGraphqlDeps
): Promise<ShopifyOrderFulfillmentSnapshot> {
  const gid = String(orderId).startsWith("gid://") ? orderId : `gid://shopify/Order/${orderId}`;
  const { data } = await shopifyAdminGraphql<{
    order?: {
      id?: string | null;
      cancelledAt?: string | null;
      displayFulfillmentStatus?: string | null;
      fulfillmentOrders?: { nodes?: GraphqlFo[] | null } | null;
    } | null;
  }>(shop, token, SHOPIFY_ORDER_BOOKING_FULFILLMENT_ORDERS, { id: gid }, deps);
  const order = data.order;
  if (!order) {
    throw Object.assign(new Error("Shopify order was not found for fulfillment revalidation."), {
      code: "SHOPIFY_ORDER_MISSING",
    });
  }
  return {
    orderGid: order.id ?? gid,
    cancelledAt: order.cancelledAt ?? null,
    displayFulfillmentStatus: order.displayFulfillmentStatus ?? null,
    fulfillmentOrders: mapGraphqlFulfillmentOrders(order.fulfillmentOrders?.nodes),
  };
}
