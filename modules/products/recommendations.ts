import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";

export type RecommendationKind = "UPSELL" | "CROSS_SELL";

async function assertSameOrgProducts(
  supabase: SupabaseClient,
  organizationId: string,
  ids: string[]
) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return unique;
  const { count, error } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("id", unique);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if ((count ?? 0) !== unique.length) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "One or more recommended products were not found.");
  }
  return unique;
}

export async function listProductRecommendations(
  supabase: SupabaseClient,
  organizationId: string,
  productIds: string[]
) {
  const map = new Map<string, { upsellProductIds: string[]; crossSellProductIds: string[] }>();
  if (!productIds.length) return map;
  const { data, error } = await supabase
    .from("product_recommendations")
    .select("product_id, related_product_id, kind, sort_order")
    .eq("organization_id", organizationId)
    .in("product_id", productIds)
    .order("sort_order", { ascending: true });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  for (const id of productIds) {
    map.set(id, { upsellProductIds: [], crossSellProductIds: [] });
  }
  for (const row of data ?? []) {
    const productId = String(row.product_id);
    const current = map.get(productId) ?? { upsellProductIds: [], crossSellProductIds: [] };
    const related = String(row.related_product_id);
    if (row.kind === "UPSELL") current.upsellProductIds.push(related);
    if (row.kind === "CROSS_SELL") current.crossSellProductIds.push(related);
    map.set(productId, current);
  }
  return map;
}

export async function replaceProductRecommendations(
  supabase: SupabaseClient,
  ctx: TenantContext,
  productId: string,
  input: { upsellProductIds?: string[]; crossSellProductIds?: string[] }
) {
  const upsell = await assertSameOrgProducts(supabase, ctx.organizationId, input.upsellProductIds ?? []);
  const cross = await assertSameOrgProducts(supabase, ctx.organizationId, input.crossSellProductIds ?? []);
  if (upsell.includes(productId) || cross.includes(productId)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "A product cannot recommend itself.");
  }
  const { error: delError } = await supabase
    .from("product_recommendations")
    .delete()
    .eq("organization_id", ctx.organizationId)
    .eq("product_id", productId);
  if (delError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, delError.message);
  const rows = [
    ...upsell.map((related, index) => ({
      organization_id: ctx.organizationId,
      product_id: productId,
      related_product_id: related,
      kind: "UPSELL",
      sort_order: index,
    })),
    ...cross.map((related, index) => ({
      organization_id: ctx.organizationId,
      product_id: productId,
      related_product_id: related,
      kind: "CROSS_SELL",
      sort_order: index,
    })),
  ];
  if (rows.length) {
    const { error } = await supabase.from("product_recommendations").insert(rows);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }
  return {
    upsellProductIds: upsell,
    crossSellProductIds: cross,
  };
}

export async function relatedIdsForKind(
  supabase: SupabaseClient,
  organizationId: string,
  productIds: string[],
  kind: RecommendationKind
) {
  if (!productIds.length) return [];
  const { data, error } = await supabase
    .from("product_recommendations")
    .select("related_product_id")
    .eq("organization_id", organizationId)
    .eq("kind", kind)
    .in("product_id", productIds)
    .order("sort_order", { ascending: true });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return [...new Set((data ?? []).map((row) => String(row.related_product_id)))];
}
