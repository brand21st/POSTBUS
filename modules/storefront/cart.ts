import type { CartLine, StoreBundle } from "@/components/storefront/store-types";

export function cartRequest(cart: CartLine[]) {
  return {
    items: cart.filter((line) => !line.bundle).map((line) => ({ productId: line.product.id, quantity: line.quantity })),
    bundles: cart.filter((line) => line.bundle).map((line) => ({ bundleId: line.bundle!.id, quantity: line.quantity })),
  };
}
export function bundleCartLine(bundle: StoreBundle): CartLine {
  const products = bundle.components.map((item) => item.product);
  return { bundle, quantity: 1, product: {
    id: `bundle:${bundle.id}`, name: bundle.name, sku: "Bundle", description: null, price: bundle.total,
    compareAtPrice: bundle.subtotal, discountPercent: bundle.subtotal ? Math.round(bundle.savings / bundle.subtotal * 100) : null,
    imageUrls: products.flatMap((p) => p.imageUrls.slice(0, 1)),
    onHand: Math.min(...bundle.components.map((item) => Math.floor(item.product.onHand / item.quantity))),
    inStock: products.every((p) => p.inStock), prepaidEnabled: products.every((p) => p.prepaidEnabled),
    codEnabled: products.every((p) => p.codEnabled), returnAvailable: products.every((p) => p.returnAvailable !== false),
  } };
}
export function ungroupBundle(cart: CartLine[], id: string): CartLine[] {
  const group = cart.find((line) => line.product.id === id);
  if (!group?.bundle) return cart;
  const next = cart.filter((line) => line !== group).map((line) => ({ ...line }));
  for (const item of group.bundle.components) {
    const existing = next.find((line) => !line.bundle && line.product.id === item.product.id);
    if (existing) existing.quantity += item.quantity * group.quantity;
    else next.push({ product: item.product, quantity: item.quantity * group.quantity });
  }
  return next;
}
