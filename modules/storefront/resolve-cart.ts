import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { loadCatalogProducts } from "@/modules/products/service";
import { resolveLineFromCatalog, type ResolvedOrderLine } from "@/modules/products/order-lines";
import { listStoreBundles } from "./bundles";
import { allocateBundlePrices, bundleInputSchema, type BundleSelection } from "./bundle-pricing";

export async function resolveStoreCart(db: SupabaseClient, organizationId: string, items: Array<{ productId: string; quantity: number }>, selections: BundleSelection[] = []) {
  if (!items.length && !selections.length) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Add at least one product.");
  const available = selections.length ? await listStoreBundles(db, organizationId, true) : [];
  const bundles = selections.map((selection) => {
    const bundle = available.find((candidate) => candidate.id === selection.bundleId);
    if (!bundle || !bundleInputSchema.safeParse(bundle).success) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "A bundle is no longer available.");
    return { ...bundle, quantity: selection.quantity };
  });
  const rows = await loadCatalogProducts(db, organizationId, [...items.map((item) => item.productId), ...bundles.flatMap((bundle) => bundle.items.map((item) => item.productId))]);
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const demand = new Map<string, number>();
  const getProduct = (id: string) => {
    const row = byId.get(id);
    if (!row || !row.active || row.store_visible === false) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "A product is no longer available.");
    return row;
  };
  const lines: ResolvedOrderLine[] = [];
  function add(productId: string, quantity: number, unitPrice?: number) {
    const row = getProduct(productId);
    demand.set(productId, (demand.get(productId) ?? 0) + quantity);
    const line = resolveLineFromCatalog({ ...row, price: Number(row.price), cod_advance_percent: row.cod_advance_percent ?? 0 }, quantity);
    lines.push({ ...line, ...(unitPrice === undefined ? {} : { unitPrice }) });
  }
  for (const item of items) add(item.productId, item.quantity);
  const snapshots = bundles.map((bundle) => {
    let allocation: ReturnType<typeof allocateBundlePrices>;
    try {
      allocation = allocateBundlePrices(bundle.items.map((item) => ({ ...item, price: Number(getProduct(item.productId).price) })), bundle.pricingMode, bundle.priceValue);
    } catch (error) { throw new AppError(ERROR_CODES.VALIDATION_ERROR, error instanceof Error ? error.message : "Invalid bundle price."); }
    for (const item of allocation.lines) add(item.productId, item.quantity * bundle.quantity, item.unitPrice);
    return { id: bundle.id, name: bundle.name, quantity: bundle.quantity, pricingMode: bundle.pricingMode, priceValue: bundle.priceValue, ...allocation };
  });
  for (const [id, quantity] of demand) {
    const row = getProduct(id);
    const balance = Array.isArray(row.inventory_balances) ? row.inventory_balances[0] : row.inventory_balances;
    if (quantity > 99 || Number(balance?.on_hand ?? 0) < quantity) throw new AppError(ERROR_CODES.VALIDATION_ERROR, `${row.name}: requested quantity is unavailable.`);
  }
  if (lines.length > 100) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Too many items in this cart.");
  const quoteVersion = createHash("sha256").update(JSON.stringify({ lines, snapshots })).digest("hex");
  return { lines, bundles: snapshots, quoteVersion, returnAvailable: [...byId.values()].every((row) => row.return_available !== false) };
}
