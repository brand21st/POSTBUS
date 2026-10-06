import type { CartLine, StoreProduct } from "@/components/storefront/store-types";

export function pickStoreRecommendations(
  source: StoreProduct[],
  cart: CartLine[],
  configuredIds: string[],
  options?: { categoryIds?: string[]; excludeId?: string; limit?: number }
) {
  const limit = Math.min(4, Math.max(1, options?.limit ?? 3));
  const inCart = new Set(cart.map((line) => line.product.id));
  if (options?.excludeId) inCart.add(options.excludeId);
  const byId = new Map(source.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const picked: StoreProduct[] = [];

  function push(item: StoreProduct | undefined) {
    if (!item || !item.inStock || inCart.has(item.id) || seen.has(item.id)) return;
    seen.add(item.id);
    picked.push(item);
  }

  for (const id of configuredIds) push(byId.get(id));
  if (picked.length >= limit) return picked.slice(0, limit);

  const categoryIds = new Set(
    options?.categoryIds ??
      cart.flatMap((line) => line.product.categoryIds ?? [])
  );
  if (categoryIds.size) {
    for (const item of source) {
      if (item.categoryIds?.some((id) => categoryIds.has(id))) push(item);
      if (picked.length >= limit) return picked.slice(0, limit);
    }
  }

  for (const item of source) {
    push(item);
    if (picked.length >= limit) break;
  }
  return picked.slice(0, limit);
}
