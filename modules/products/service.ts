import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { z } from "zod";
import { mapProductImageUrls } from "@/modules/products/images";
import {
  listProductRecommendations,
  replaceProductRecommendations,
} from "@/modules/products/recommendations";
import type {
  adjustInventorySchema,
  createProductSchema,
  inventoryMovementListQuery,
  productListQuery,
  updateProductSchema,
} from "@/modules/products/schema";

type CreateInput = z.infer<typeof createProductSchema>;
type UpdateInput = z.infer<typeof updateProductSchema>;
type AdjustInput = z.infer<typeof adjustInventorySchema>;
type ListQuery = z.infer<typeof productListQuery>;
type MovementQuery = z.infer<typeof inventoryMovementListQuery>;

const PRODUCT_SELECT =
  "id, organization_id, name, sku, public_slug, price, compare_at_price, description, store_visible, low_stock_threshold, weight_grams, active, prepaid_enabled, cod_enabled, cod_advance_percent, return_available, image_urls, created_at, updated_at, inventory_balances(on_hand, reserved)";

function productPublicSlug(name: string, id: string) {
  const base = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "product";
  return `${base}-${id.replace(/-/g, "").slice(-6)}`;
}

function rpcError(error: { code?: string; message?: string } | null): never {
  const message = error?.message || "Inventory request failed.";
  const code = error?.code || "";
  if (code === "42501" || /permission/i.test(message)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "You do not have permission to change inventory.");
  }
  if (code === "23505" || /duplicate|unique/i.test(message)) {
    throw new AppError(ERROR_CODES.CONFLICT, "A product with this SKU already exists in this workspace.");
  }
  if (code === "P0002" || /not found/i.test(message)) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Product not found.");
  }
  if (/below zero|reserved stock/i.test(message)) {
    throw new AppError(ERROR_CODES.CONFLICT, message);
  }
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, message);
}

function firstBalance(value: unknown): { on_hand?: number; reserved?: number } | null {
  if (!value) return null;
  if (Array.isArray(value)) return (value[0] as { on_hand?: number; reserved?: number }) ?? null;
  if (typeof value === "object") return value as { on_hand?: number; reserved?: number };
  return null;
}

export function mapProduct(row: Record<string, unknown>, categoryIds: string[] = []) {
  const balance = firstBalance(row.inventory_balances);
  const images = mapProductImageUrls(row.image_urls);
  const compareAt = row.compare_at_price == null ? null : Number(row.compare_at_price);
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    sku: row.sku,
    publicSlug: row.public_slug,
    price: Number(row.price ?? 0),
    compareAtPrice: compareAt != null && Number.isFinite(compareAt) ? compareAt : null,
    description: (row.description as string | null) ?? null,
    storeVisible: row.store_visible !== false,
    lowStockThreshold: Number(row.low_stock_threshold ?? 5),
    weightGrams: Number(row.weight_grams ?? 0),
    active: Boolean(row.active),
    prepaidEnabled: Boolean(row.prepaid_enabled),
    codEnabled: Boolean(row.cod_enabled),
    codAdvancePercent: Number(row.cod_advance_percent ?? 0),
    returnAvailable: row.return_available !== false,
    imageUrls: images.imageUrls,
    imagePaths: images.imagePaths,
    categoryIds,
    upsellProductIds: [] as string[],
    crossSellProductIds: [] as string[],
    onHand: Number(balance?.on_hand ?? 0),
    reserved: Number(balance?.reserved ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function categoryIdsByProduct(
  supabase: SupabaseClient,
  organizationId: string,
  productIds: string[]
) {
  const map = new Map<string, string[]>();
  if (!productIds.length) return map;
  const { data, error } = await supabase
    .from("product_category_members")
    .select("product_id, category_id")
    .eq("organization_id", organizationId)
    .in("product_id", productIds);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  for (const row of data ?? []) {
    const productId = String(row.product_id);
    const current = map.get(productId) ?? [];
    current.push(String(row.category_id));
    map.set(productId, current);
  }
  return map;
}

export async function replaceProductCategories(
  supabase: SupabaseClient,
  ctx: TenantContext,
  productId: string,
  categoryIds: string[]
) {
  const unique = [...new Set(categoryIds)];
  if (unique.length) {
    const { count, error } = await supabase
      .from("product_categories")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.organizationId)
      .in("id", unique);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    if ((count ?? 0) !== unique.length) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "One or more categories were not found.");
    }
  }
  const { error: delError } = await supabase
    .from("product_category_members")
    .delete()
    .eq("organization_id", ctx.organizationId)
    .eq("product_id", productId);
  if (delError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, delError.message);
  if (!unique.length) return;
  const { error: insError } = await supabase.from("product_category_members").insert(
    unique.map((categoryId) => ({
      organization_id: ctx.organizationId,
      product_id: productId,
      category_id: categoryId,
    }))
  );
  if (insError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, insError.message);
}

function optionalBoolean(value: "true" | "false" | "all" | undefined) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function productAnalyticsWindow(range: ListQuery["analyticsRange"]) {
  const to = new Date();
  if (range === "all") return { from: new Date("2000-01-01T00:00:00.000Z"), to };
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  return { from: new Date(to.getTime() - days * 86_400_000), to };
}

export async function listProducts(supabase: SupabaseClient, ctx: TenantContext, query: ListQuery) {
  const offset = (query.page - 1) * query.pageSize;
  const analyticsWindow = productAnalyticsWindow(query.analyticsRange);
  const { data: ranked, error: rankedError } = await supabase.rpc("inventory_product_page", {
    p_organization_id: ctx.organizationId,
    p_from: analyticsWindow.from.toISOString(),
    p_to: analyticsWindow.to.toISOString(),
    p_query: query.q || null,
    p_active: optionalBoolean(query.active),
    p_store_visible: optionalBoolean(query.storeVisible),
    p_category_id: query.categoryId ?? null,
    p_stock_state: query.stock && query.stock !== "all" ? query.stock : null,
    p_prepaid_enabled: optionalBoolean(query.prepaid),
    p_cod_enabled: optionalBoolean(query.cod),
    p_price_min: query.priceMin ?? null,
    p_price_max: query.priceMax ?? null,
    p_stock_min: query.stockMin ?? null,
    p_stock_max: query.stockMax ?? null,
    p_created_from: query.createdFrom ?? null,
    p_created_to: query.createdTo ?? null,
    p_updated_from: query.updatedFrom ?? null,
    p_updated_to: query.updatedTo ?? null,
    p_best_seller: optionalBoolean(query.bestSeller),
    p_sort: query.sort,
    p_limit: query.pageSize,
    p_offset: offset,
  });
  if (rankedError) rpcError(rankedError);
  const metricsRows = (ranked ?? []) as Array<{
    product_id: string;
    order_count: number | string;
    units_sold: number | string;
    revenue: number | string;
    sales_rank: number | string | null;
    total_count: number | string;
  }>;
  const ids = metricsRows.map((row) => String(row.product_id));
  if (!ids.length) {
    return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
  }
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("organization_id", ctx.organizationId)
    .in("id", ids);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const byId = new Map(((data ?? []) as Record<string, unknown>[]).map((row) => [String(row.id), row]));
  const metrics = new Map(metricsRows.map((row) => [String(row.product_id), row]));
  const rows = ids.map((id) => byId.get(id)).filter((row): row is Record<string, unknown> => Boolean(row));
  const [categories, recs, featured] = await Promise.all([
    categoryIdsByProduct(supabase, ctx.organizationId, ids),
    listProductRecommendations(supabase, ctx.organizationId, ids),
    loadFeaturedSet(supabase, ctx.organizationId),
  ]);
  return {
    items: rows.map((row) => {
      const id = String(row.id);
      const mapped = mapProduct(row, categories.get(id) ?? []);
      const related = recs.get(id);
      const performance = metrics.get(id);
      const salesRank = performance?.sales_rank == null ? null : Number(performance.sales_rank);
      return {
        ...mapped,
        featured: featured.has(id),
        orderCount: Number(performance?.order_count ?? 0),
        unitsSold: Number(performance?.units_sold ?? 0),
        revenue: Number(performance?.revenue ?? 0),
        salesRank,
        // Best sellers are the top three products by qualifying units sold,
        // with revenue as the tie-breaker, in the selected analytics window.
        bestSeller: salesRank != null && salesRank <= 3,
        upsellProductIds: related?.upsellProductIds ?? [],
        crossSellProductIds: related?.crossSellProductIds ?? [],
      };
    }),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(metricsRows[0]?.total_count ?? 0),
  };
}

async function loadFeaturedSet(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("storefront_settings")
    .select("featured_product_ids")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return new Set(Array.isArray(data?.featured_product_ids) ? (data?.featured_product_ids as string[]) : []);
}

async function setFeaturedProduct(
  supabase: SupabaseClient,
  ctx: TenantContext,
  productId: string,
  featured: boolean
) {
  const current = await loadFeaturedSet(supabase, ctx.organizationId);
  if (featured) current.add(productId);
  else current.delete(productId);
  const ids = [...current];
  const { error } = await supabase.from("storefront_settings").upsert({
    organization_id: ctx.organizationId,
    featured_product_ids: ids,
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
}

export async function getProduct(supabase: SupabaseClient, ctx: TenantContext, id: string) {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Product not found.");
  const categories = await categoryIdsByProduct(supabase, ctx.organizationId, [id]);
  const recs = await listProductRecommendations(supabase, ctx.organizationId, [id]);
  const featured = await loadFeaturedSet(supabase, ctx.organizationId);
  const mapped = mapProduct(data as Record<string, unknown>, categories.get(id) ?? []);
  const related = recs.get(id);
  return {
    ...mapped,
    featured: featured.has(id),
    upsellProductIds: related?.upsellProductIds ?? [],
    crossSellProductIds: related?.crossSellProductIds ?? [],
  };
}

export async function createProduct(supabase: SupabaseClient, ctx: TenantContext, input: CreateInput) {
  const { data, error } = await supabase.rpc("create_inventory_product", {
    p_organization_id: ctx.organizationId,
    p_name: input.name,
    p_sku: input.sku,
    p_price: input.price,
    p_weight_grams: input.weightGrams,
    p_prepaid_enabled: input.prepaidEnabled,
    p_cod_enabled: input.codEnabled,
    p_cod_advance_percent: input.codEnabled ? (input.codAdvancePercent ?? 0) : 0,
    p_opening_stock: input.openingStock ?? 0,
    p_created_by: ctx.userId,
  });
  if (error) rpcError(error);
  if (!data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not create the product.");
  const id = String(data);
  const extras: Record<string, unknown> = { public_slug: productPublicSlug(input.name, id) };
  if (input.compareAtPrice != null) extras.compare_at_price = input.compareAtPrice;
  if (input.description != null) extras.description = input.description || null;
  if (input.storeVisible != null) extras.store_visible = input.storeVisible;
  if (input.returnAvailable != null) extras.return_available = input.returnAvailable;
  if (input.lowStockThreshold != null) extras.low_stock_threshold = input.lowStockThreshold;
  if (Object.keys(extras).length) {
    const { error: extraError } = await supabase
      .from("products")
      .update(extras)
      .eq("organization_id", ctx.organizationId)
      .eq("id", id);
    if (extraError) rpcError(extraError);
  }
  if (input.categoryIds) {
    await replaceProductCategories(supabase, ctx, id, input.categoryIds);
  }
  if (input.upsellProductIds || input.crossSellProductIds) {
    await replaceProductRecommendations(supabase, ctx, id, {
      upsellProductIds: input.upsellProductIds,
      crossSellProductIds: input.crossSellProductIds,
    });
  }
  if (input.featured != null) {
    await setFeaturedProduct(supabase, ctx, id, input.featured);
  }
  return getProduct(supabase, ctx, id);
}

export async function updateProduct(
  supabase: SupabaseClient,
  ctx: TenantContext,
  id: string,
  input: UpdateInput
) {
  const current = await getProduct(supabase, ctx, id);
  const prepaid = input.prepaidEnabled ?? current.prepaidEnabled;
  const cod = input.codEnabled ?? current.codEnabled;
  if (!prepaid && !cod) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enable prepaid, COD, or both.");
  }

  const patch: Record<string, unknown> = {};
  if (input.name != null) patch.name = input.name;
  if (input.sku != null) patch.sku = input.sku;
  if (input.price != null) patch.price = input.price;
  if (input.weightGrams != null) patch.weight_grams = input.weightGrams;
  if (input.active != null) patch.active = input.active;
  if (input.prepaidEnabled != null) patch.prepaid_enabled = input.prepaidEnabled;
  if (input.codEnabled != null) patch.cod_enabled = input.codEnabled;
  if (input.codAdvancePercent != null || input.codEnabled === false) {
    patch.cod_advance_percent = cod ? (input.codAdvancePercent ?? current.codAdvancePercent) : 0;
  }
  if (input.compareAtPrice !== undefined) patch.compare_at_price = input.compareAtPrice;
  if (input.description !== undefined) patch.description = input.description || null;
  if (input.storeVisible != null) patch.store_visible = input.storeVisible;
  if (input.returnAvailable != null) patch.return_available = input.returnAvailable;
  if (input.lowStockThreshold != null) patch.low_stock_threshold = input.lowStockThreshold;
  if (input.imageUrls) {
    const { reorderProductImages } = await import("@/modules/products/images");
    await reorderProductImages(supabase, ctx, id, input.imageUrls);
  }
  if (input.categoryIds) {
    await replaceProductCategories(supabase, ctx, id, input.categoryIds);
  }
  if (input.upsellProductIds || input.crossSellProductIds) {
    await replaceProductRecommendations(supabase, ctx, id, {
      upsellProductIds: input.upsellProductIds,
      crossSellProductIds: input.crossSellProductIds,
    });
  }
  if (input.featured != null) {
    await setFeaturedProduct(supabase, ctx, id, input.featured);
  }

  if (!Object.keys(patch).length) {
    return getProduct(supabase, ctx, id);
  }

  const { data, error } = await supabase
    .from("products")
    .update(patch)
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) rpcError(error);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Product not found.");
  return getProduct(supabase, ctx, id);
}

export async function adjustProductStock(
  supabase: SupabaseClient,
  ctx: TenantContext,
  id: string,
  input: AdjustInput
) {
  await getProduct(supabase, ctx, id);
  const reason = input.reason ?? "ADJUSTMENT";
  if (reason !== "ADJUSTMENT" && reason !== "OPENING") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Manual adjustments must use ADJUSTMENT.");
  }
  const { data, error } = await supabase.rpc("adjust_inventory", {
    p_organization_id: ctx.organizationId,
    p_product_id: id,
    p_quantity_delta: input.quantityDelta,
    p_reason: reason,
    p_note: input.note ?? null,
    p_created_by: ctx.userId,
    p_order_id: null,
    p_order_line_item_id: null,
  });
  if (error) rpcError(error);
  const result = Array.isArray(data) ? data[0] : data;
  const product = await getProduct(supabase, ctx, id);
  return {
    ...product,
    movementId: (result as { movementId?: string } | null)?.movementId ?? null,
  };
}

export async function listInventoryMovements(
  supabase: SupabaseClient,
  ctx: TenantContext,
  query: MovementQuery
) {
  if (query.productId) await getProduct(supabase, ctx, query.productId);
  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;
  let builder = supabase
    .from("inventory_movements")
    .select(
      "id, organization_id, product_id, quantity_delta, reason, order_id, order_line_item_id, note, created_by, balance_after, created_at, products(name, sku)",
      { count: "exact" }
    )
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (query.productId) builder = builder.eq("product_id", query.productId);
  if (query.reason) builder = builder.eq("reason", query.reason);
  if (query.from) builder = builder.gte("created_at", query.from);
  if (query.to) builder = builder.lte("created_at", query.to);
  const { data, error, count } = await builder;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return {
    items: (data ?? []).map((row) => {
      const product = Array.isArray(row.products) ? row.products[0] : row.products;
      return {
        id: row.id,
        productId: row.product_id,
        productName: (product as { name?: string } | null)?.name ?? null,
        productSku: (product as { sku?: string } | null)?.sku ?? null,
        quantityDelta: row.quantity_delta,
        reason: row.reason,
        orderId: row.order_id,
        orderLineItemId: row.order_line_item_id,
        note: row.note,
        createdBy: row.created_by,
        balanceAfter: row.balance_after,
        createdAt: row.created_at,
      };
    }),
    page: query.page,
    pageSize: query.pageSize,
    total: count ?? 0,
  };
}

export async function bulkUpdateProducts(
  supabase: SupabaseClient,
  ctx: TenantContext,
  input: { ids: string[]; active?: boolean; storeVisible?: boolean }
) {
  if (input.active == null && input.storeVisible == null) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Choose a bulk action.");
  }
  const patch: Record<string, unknown> = {};
  if (input.active != null) patch.active = input.active;
  if (input.storeVisible != null) patch.store_visible = input.storeVisible;
  const { data, error } = await supabase
    .from("products")
    .update(patch)
    .eq("organization_id", ctx.organizationId)
    .in("id", input.ids)
    .select("id");
  if (error) rpcError(error);
  return { updated: data?.length ?? 0 };
}

export async function duplicateProduct(supabase: SupabaseClient, ctx: TenantContext, id: string) {
  const current = await getProduct(supabase, ctx, id);
  const copy = await createProduct(supabase, ctx, {
    name: `${current.name} copy`,
    sku: `${String(current.sku).slice(0, 52)}-${Date.now().toString(36).slice(-6).toUpperCase()}`,
    price: current.price,
    compareAtPrice: current.compareAtPrice,
    description: current.description,
    weightGrams: current.weightGrams,
    openingStock: 0,
    prepaidEnabled: current.prepaidEnabled,
    codEnabled: current.codEnabled,
    codAdvancePercent: current.codAdvancePercent,
    returnAvailable: current.returnAvailable,
    storeVisible: false,
    featured: false,
    lowStockThreshold: current.lowStockThreshold,
    categoryIds: current.categoryIds,
    upsellProductIds: current.upsellProductIds,
    crossSellProductIds: current.crossSellProductIds,
  });
  return copy;
}

export async function loadCatalogProducts(
  supabase: SupabaseClient,
  organizationId: string,
  productIds: string[]
) {
  const unique = [...new Set(productIds.filter(Boolean))];
  if (!unique.length) return [];
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, sku, price, compare_at_price, description, store_visible, weight_grams, active, prepaid_enabled, cod_enabled, cod_advance_percent, return_available, image_urls, inventory_balances(on_hand)"
    )
    .eq("organization_id", organizationId)
    .in("id", unique);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return data ?? [];
}
