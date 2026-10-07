import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { orIlike } from "@/lib/api/filters";
import { mapProductImageUrls } from "@/modules/products/images";
import { discountPercent } from "@/modules/storefront/pricing";
import { mapCategory } from "@/modules/products/categories";
import { listProductRecommendations } from "@/modules/products/recommendations";
import { getStorefrontSettings } from "@/modules/storefront/service";
import type { PublicLinkRef } from "@/modules/customer-order-links/public";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { policyBodyForSlug, STORE_POLICY_SLUGS, STORE_POLICY_TITLES, type StorePolicySlug } from "@/modules/storefront/footer";
import { loadOrganizationPolicies } from "@/modules/vachat/policies";

export function publicStoreClient() {
  if (!hasAdminClient()) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "This store is temporarily unavailable.");
  }
  return createAdminClient();
}

export async function assertStorePublished(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("storefront_settings")
    .select("published")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (data?.published === false) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Store temporarily unavailable.");
  }
}

async function organizationFromLink(supabase: SupabaseClient, ref: PublicLinkRef) {
  const { findPublicCollectionLink } = await import("@/modules/customer-order-links/public");
  const row = await findPublicCollectionLink(supabase, ref);
  if (!row || row.status !== "ACTIVE") {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "This store link is not valid.");
  }
  return row.organization_id;
}

function firstBalance(value: unknown) {
  if (!value) return 0;
  if (Array.isArray(value)) return Number(value[0]?.on_hand ?? 0);
  if (typeof value === "object" && value && "on_hand" in value) {
    return Number((value as { on_hand?: number }).on_hand ?? 0);
  }
  return 0;
}

export function mapPublicProduct(row: Record<string, unknown>) {
  const price = Number(row.price ?? 0);
  const compareAt = row.compare_at_price == null ? null : Number(row.compare_at_price);
  const images = mapProductImageUrls(row.image_urls);
  const onHand = firstBalance(row.inventory_balances);
  return {
    id: String(row.id),
    name: String(row.name),
    sku: String(row.sku ?? ""),
    slug: String(row.public_slug ?? ""),
    description: (row.description as string | null) ?? null,
    price,
    compareAtPrice: compareAt != null && compareAt > price ? compareAt : null,
    discountPercent: discountPercent(price, compareAt),
    weightGrams: Number(row.weight_grams ?? 0),
    imageUrls: images.imageUrls,
    onHand,
    inStock: onHand > 0,
    prepaidEnabled: Boolean(row.prepaid_enabled),
    codEnabled: Boolean(row.cod_enabled),
    codAdvancePercent: Number(row.cod_advance_percent ?? 0),
    returnAvailable: row.return_available !== false,
    lowStockThreshold: Number(row.low_stock_threshold ?? 5),
    createdAt: String(row.created_at ?? ""),
  };
}

const PUBLIC_PRODUCT_SELECT =
  "id, name, sku, public_slug, price, compare_at_price, description, weight_grams, prepaid_enabled, cod_enabled, cod_advance_percent, return_available, low_stock_threshold, image_urls, created_at, inventory_balances(on_hand)";

async function publicBestSellerIds(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase.rpc("inventory_product_page", {
    p_organization_id: organizationId,
    p_from: "2000-01-01T00:00:00.000Z",
    p_to: new Date().toISOString(),
    p_best_seller: true,
    p_sort: "bestSeller",
    p_limit: 3,
    p_offset: 0,
  });
  return (data ?? [])
    .filter((row: { units_sold?: number | string }) => Number(row.units_sold ?? 0) > 0)
    .map((row: { product_id: string }) => String(row.product_id));
}

export async function loadPublicStorefront(supabase: SupabaseClient, ref: PublicLinkRef) {
  const organizationId = await organizationFromLink(supabase, ref);
  const settings = await getStorefrontSettings(supabase, {
    organizationId,
    userId: "",
    email: null,
    fullName: null,
    organizationName: "",
    role: "OWNER",
    permissions: [],
  });
  const { data: categories } = await supabase
    .from("product_categories")
    .select("id, organization_id, name, slug, description, image_path, sort_order, active, created_at, updated_at")
    .eq("organization_id", organizationId)
    .eq("active", true)
    .order("sort_order", { ascending: true });

  const catalog = settings.published
    ? await listPublicProducts(supabase, organizationId, { page: 1, pageSize: 12 })
    : { items: [], page: 1, pageSize: 12, total: 0 };
  const featured = settings.published
    ? await loadRelatedPublicProducts(supabase, organizationId, settings.featuredProductIds)
    : [];
  return {
    published: settings.published,
    storeName: settings.storeName,
    logoUrl: settings.logoUrl,
    accentColor: settings.accentColor,
    seoTitle: settings.seoTitle,
    seoDescription: settings.seoDescription,
    slides: settings.published ? settings.slides.filter((slide) => slide.enabled && slide.imageUrl) : [],
    categories: settings.published
      ? (categories ?? []).map((row) => mapCategory(row as Record<string, unknown>))
      : [],
    featuredProductIds: settings.published ? settings.featuredProductIds : [],
    products: { ...catalog, featured },
    workspace: settings.workspace,
    footer: settings.published ? settings.footerPreview ?? null : null,
  };
}

export async function listPublicProducts(
  supabase: SupabaseClient,
  organizationId: string,
  query: { page: number; pageSize: number; q?: string; categoryId?: string }
) {
  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;
  let builder = supabase
    .from("products")
    .select(PUBLIC_PRODUCT_SELECT, { count: "exact" })
    .eq("organization_id", organizationId)
    .eq("active", true)
    .eq("store_visible", true)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (query.q) {
    const filter = orIlike(["name", "sku"], query.q);
    const { data: matchingCategories } = await supabase
      .from("product_categories")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("name", `%${query.q.replace(/[%_,]/g, "")}%`);
    const categoryIds = (matchingCategories ?? []).map((row) => String(row.id));
    let categoryProductIds: string[] = [];
    if (categoryIds.length) {
      const { data: members } = await supabase
        .from("product_category_members")
        .select("product_id")
        .eq("organization_id", organizationId)
        .in("category_id", categoryIds);
      categoryProductIds = [...new Set((members ?? []).map((row) => String(row.product_id)))];
    }
    const clauses = [filter, categoryProductIds.length ? `id.in.(${categoryProductIds.join(",")})` : null].filter(
      Boolean
    );
    if (clauses.length) builder = builder.or(clauses.join(","));
  }
  if (query.categoryId) {
    const { data: members } = await supabase
      .from("product_category_members")
      .select("product_id")
      .eq("organization_id", organizationId)
      .eq("category_id", query.categoryId);
    const ids = [...new Set((members ?? []).map((row) => String(row.product_id)))];
    if (!ids.length) return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
    builder = builder.in("id", ids);
  }
  const { data, error, count } = await builder;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const items = (data ?? []).map((row) => mapPublicProduct(row as Record<string, unknown>));
  const recs = await listProductRecommendations(
    supabase,
    organizationId,
    items.map((item) => item.id)
  );
  const { data: members } = items.length
    ? await supabase
        .from("product_category_members")
        .select("product_id, category_id")
        .eq("organization_id", organizationId)
        .in("product_id", items.map((item) => item.id))
    : { data: [] as Array<{ product_id: string; category_id: string }> };
  const categoriesByProduct = new Map<string, string[]>();
  for (const row of members ?? []) {
    const productId = String(row.product_id);
    const current = categoriesByProduct.get(productId) ?? [];
    current.push(String(row.category_id));
    categoriesByProduct.set(productId, current);
  }
  const relatedIds = [
    ...items.flatMap((item) => recs.get(item.id)?.upsellProductIds ?? []),
    ...items.flatMap((item) => recs.get(item.id)?.crossSellProductIds ?? []),
  ];
  const bestSellerIds = await publicBestSellerIds(supabase, organizationId);
  const [related, bestSellerProducts] = await Promise.all([
    loadRelatedPublicProducts(supabase, organizationId, relatedIds),
    loadRelatedPublicProducts(supabase, organizationId, bestSellerIds),
  ]);
  const bestSellerSet = new Set(bestSellerIds);
  return {
    items: items.map((item) => ({
      ...item,
      bestSeller: bestSellerSet.has(item.id),
      upsellIds: recs.get(item.id)?.upsellProductIds ?? [],
      crossSellIds: recs.get(item.id)?.crossSellProductIds ?? [],
      categoryIds: categoriesByProduct.get(item.id) ?? [],
    })),
    related: related.map((item) => ({ ...item, bestSeller: bestSellerSet.has(item.id) })),
    bestSellers: bestSellerProducts.map((item) => ({ ...item, bestSeller: true })),
    page: query.page,
    pageSize: query.pageSize,
    total: count ?? 0,
  };
}

async function loadRelatedPublicProducts(supabase: SupabaseClient, organizationId: string, ids: string[]) {
  const unique = [...new Set(ids)].slice(0, 24);
  if (!unique.length) return [] as ReturnType<typeof mapPublicProduct>[];
  const { data } = await supabase
    .from("products")
    .select(PUBLIC_PRODUCT_SELECT)
    .eq("organization_id", organizationId)
    .eq("active", true)
    .eq("store_visible", true)
    .in("id", unique);
  return (data ?? []).map((row) => mapPublicProduct(row as Record<string, unknown>));
}

export async function getPublicProduct(supabase: SupabaseClient, organizationId: string, id: string) {
  const { data, error } = await supabase
    .from("products")
    .select(PUBLIC_PRODUCT_SELECT)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .eq("active", true)
    .eq("store_visible", true)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Product not found.");
  const mapped = mapPublicProduct(data as Record<string, unknown>);
  const recs = await listProductRecommendations(supabase, organizationId, [id]);
  const { data: members } = await supabase
    .from("product_category_members")
    .select("category_id")
    .eq("organization_id", organizationId)
    .eq("product_id", id);
  return {
    ...mapped,
    categoryIds: [...new Set((members ?? []).map((row) => String(row.category_id)))],
    upsellIds: recs.get(id)?.upsellProductIds ?? [],
    crossSellIds: recs.get(id)?.crossSellProductIds ?? [],
  };
}

export async function getPublicProductBySlug(
  supabase: SupabaseClient,
  organizationId: string,
  slug: string
) {
  const { data, error } = await supabase
    .from("products")
    .select(PUBLIC_PRODUCT_SELECT)
    .eq("organization_id", organizationId)
    .eq("public_slug", slug)
    .eq("active", true)
    .eq("store_visible", true)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Product not found.");
  return mapPublicProduct(data as Record<string, unknown>);
}

export function isStorePolicySlug(value: string): value is StorePolicySlug {
  return (STORE_POLICY_SLUGS as readonly string[]).includes(value);
}

export async function getPublicStorePolicy(supabase: SupabaseClient, workspace: string, slug: StorePolicySlug) {
  const store = await loadPublicStorefront(supabase, { kind: "path", workspace });
  const organizationId = await organizationFromLink(supabase, { kind: "path", workspace });
  const policies = await loadOrganizationPolicies(supabase, organizationId);
  const body = policyBodyForSlug(slug, policies);
  if (!body) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "This policy is not published.");
  return {
    store,
    slug,
    title: STORE_POLICY_TITLES[slug],
    body,
  };
}

export { organizationFromLink };
