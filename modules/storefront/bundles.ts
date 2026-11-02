import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { bundleInputSchema, type BundleInput } from "./bundle-pricing";

export async function listStoreBundles(db: SupabaseClient, organizationId: string, publishedOnly = false) {
  let query = db.from("storefront_bundles").select("id,name,pricing_mode,price_value,published,sort_order,storefront_bundle_items(product_id,quantity)").eq("organization_id", organizationId).order("sort_order").order("id").limit(100);
  if (publishedOnly) query = query.eq("published", true);
  const { data, error } = await query;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not load bundles.");
  return (data ?? []).map((row) => ({ id: String(row.id), name: String(row.name), pricingMode: row.pricing_mode as "FIXED" | "PERCENT", priceValue: Number(row.price_value), published: Boolean(row.published), sortOrder: Number(row.sort_order), items: row.storefront_bundle_items.map((item: { product_id: string; quantity: number }) => ({ productId: item.product_id, quantity: Number(item.quantity) })) }));
}
export async function saveStoreBundle(db: SupabaseClient, ctx: TenantContext, id: string | null, input: BundleInput) {
  const parsed = bundleInputSchema.parse(input);
  const { data, error } = await db.rpc("save_storefront_bundle", { p_organization_id: ctx.organizationId, p_id: id, p_bundle: parsed });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not save bundle. Check its products and pricing.");
  return { id: data };
}
