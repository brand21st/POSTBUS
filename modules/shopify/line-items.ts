import { shopifyLineItemGid } from "@/modules/shopify/eligibility";

export type ShopifyLineQuantitySource = {
  id?: string | number | null;
  quantity?: number | null;
  current_quantity?: number | null;
  currentQuantity?: number | null;
  unfulfilled_quantity?: number | null;
  fulfillable_quantity?: number | null;
  title?: string | null;
  name?: string | null;
  sku?: string | null;
  price?: string | number | null;
};

export type ShopifyLineOrderSource = {
  edited?: boolean | null;
  tags?: string | string[] | null;
  line_items?: ShopifyLineQuantitySource[] | null;
};

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function tagList(tags?: string | string[] | null) {
  const raw = Array.isArray(tags) ? tags : String(tags ?? "").split(",");
  return raw.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean);
}

/** REST current_quantity / GraphQL currentQuantity. Null means the payload omitted it. */
export function shopifyCurrentQuantity(item: ShopifyLineQuantitySource): number | null {
  const current = asNumber(item.current_quantity ?? item.currentQuantity);
  if (current == null) return null;
  return Math.max(0, current);
}

export function shopifyOrderLooksEdited(order: ShopifyLineOrderSource): boolean {
  if (order.edited === true) return true;
  if (tagList(order.tags).includes("order-edited")) return true;
  const items = order.line_items ?? [];
  const hasRemoved = items.some((item) => shopifyCurrentQuantity(item) === 0);
  const hasActive = items.some((item) => (shopifyCurrentQuantity(item) ?? -1) > 0);
  return hasRemoved && hasActive;
}

export type ActiveShopifyLineSelection<T extends ShopifyLineQuantitySource = ShopifyLineQuantitySource> = {
  items: Array<T & { quantity: number; current_quantity: number }>;
  incomplete: boolean;
  skipLineWrite: boolean;
  needsAuthoritativeRead: boolean;
};

/**
 * Active commerce lines only. Never keys off title, SKU, product, or variant.
 * Missing current quantity on an edited order must not fall back to original quantity.
 */
export function selectActiveShopifyLineItems<T extends ShopifyLineQuantitySource>(
  order: ShopifyLineOrderSource & { line_items?: T[] | null }
): ActiveShopifyLineSelection<T> {
  const items = order.line_items ?? [];
  const edited = shopifyOrderLooksEdited(order);
  const incomplete = items.some((item) => shopifyCurrentQuantity(item) == null);
  if (incomplete && edited) {
    return {
      items: [],
      incomplete: true,
      skipLineWrite: true,
      needsAuthoritativeRead: true,
    };
  }

  const active: ActiveShopifyLineSelection<T>["items"] = [];
  for (const item of items) {
    const current = shopifyCurrentQuantity(item);
    const qty = current ?? Math.max(0, asNumber(item.quantity) ?? 0);
    if (qty <= 0) continue;
    const id = shopifyLineItemGid(item.id) ?? item.id ?? null;
    active.push({
      ...item,
      id,
      quantity: qty,
      current_quantity: current ?? qty,
    });
  }

  return {
    items: active,
    incomplete,
    skipLineWrite: false,
    needsAuthoritativeRead: false,
  };
}

export function shopifyLineSnapshotNeedsRefresh(order: ShopifyLineOrderSource) {
  return selectActiveShopifyLineItems(order).needsAuthoritativeRead;
}
