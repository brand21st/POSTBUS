import type { NextRequest } from "next/server";
import { z } from "zod";
import { bundleInputSchema } from "@/modules/storefront/bundle-pricing";
import { listStoreBundles, saveStoreBundle } from "@/modules/storefront/bundles";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import {
  adjustInventorySchema,
  categoryReorderSchema,
  categorySchema,
  categoryUpdateSchema,
  createProductSchema,
  inventoryAnalyticsQuery,
  inventoryMovementListQuery,
  productBulkUpdateSchema,
  productImageSlotQuery,
  productListQuery,
  productRecommendationsSchema,
  updateProductSchema,
} from "@/modules/products/schema";
import { getInventoryAnalytics } from "@/modules/products/analytics";
import {
  createCategory,
  deleteCategory,
  listCategories,
  removeCategoryImage,
  reorderCategories,
  updateCategory,
  uploadCategoryImage,
} from "@/modules/products/categories";
import { removeProductImage, uploadProductImage } from "@/modules/products/images";
import { replaceProductRecommendations } from "@/modules/products/recommendations";
import {
  adjustProductStock,
  bulkUpdateProducts,
  createProduct,
  deleteProduct,
  duplicateProduct,
  getProduct,
  listInventoryMovements,
  listProducts,
  updateProduct,
} from "@/modules/products/service";
import { storefrontSettingsSchema, storefrontSlideSchema } from "@/modules/storefront/schema";
import {
  deleteStorefrontSlide,
  duplicateStorefrontSlide,
  getStorefrontSettings,
  updateStorefrontSettings,
  updateStorefrontSlide,
  uploadStorefrontAsset,
} from "@/modules/storefront/service";

export async function handleInventoryRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  key: string,
  method: string,
  slugs: string[]
) {
  if (key === "GET inventory/bundles") return listStoreBundles(supabase, ctx.organizationId);
  if (key === "POST inventory/bundles") return saveStoreBundle(supabase, ctx, null, bundleInputSchema.parse(await request.json()));
  if (slugs[0] === "inventory" && slugs[1] === "bundles" && slugs[2] && slugs.length === 3) {
    const id = z.string().uuid().parse(slugs[2]);
    if (method === "PATCH") return saveStoreBundle(supabase, ctx, id, bundleInputSchema.parse(await request.json()));
    if (method === "DELETE") {
      const { error } = await supabase.from("storefront_bundles").delete().eq("organization_id", ctx.organizationId).eq("id", id);
      if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not delete bundle.");
      return { deleted: true };
    }
  }
  if (key === "GET products") {
    const parsed = productListQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
    return listProducts(supabase, ctx, parsed);
  }

  if (key === "POST products") {
    const body = createProductSchema.parse(await request.json());
    return createProduct(supabase, ctx, body);
  }

  if (key === "GET inventory/movements") {
    const parsed = inventoryMovementListQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
    return listInventoryMovements(supabase, ctx, parsed);
  }

  if (method === "GET" && slugs[0] === "products" && slugs[1] && !slugs[2]) {
    return getProduct(supabase, ctx, slugs[1]);
  }

  if (method === "PATCH" && slugs[0] === "products" && slugs[1] && !slugs[2]) {
    const body = updateProductSchema.parse(await request.json());
    return updateProduct(supabase, ctx, slugs[1], body);
  }

  if (method === "DELETE" && slugs[0] === "products" && slugs[1] && !slugs[2]) {
    return deleteProduct(supabase, ctx, slugs[1]);
  }

  if (method === "POST" && slugs[0] === "products" && slugs[1] && slugs[2] === "images") {
    const form = await request.formData();
    const file = form.get("image") ?? form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Choose a product photo to upload.");
    }
    const slotRaw = form.get("slot");
    const slot =
      slotRaw == null || String(slotRaw).trim() === ""
        ? undefined
        : productImageSlotQuery.parse({ slot: slotRaw }).slot;
    return uploadProductImage(supabase, ctx, slugs[1], file, slot);
  }

  if (method === "DELETE" && slugs[0] === "products" && slugs[1] && slugs[2] === "images") {
    const slot = productImageSlotQuery.parse(Object.fromEntries(request.nextUrl.searchParams)).slot;
    return removeProductImage(supabase, ctx, slugs[1], slot);
  }

  if (method === "POST" && slugs[0] === "products" && slugs[1] && slugs[2] === "adjustments") {
    const body = adjustInventorySchema.parse(await request.json());
    return adjustProductStock(supabase, ctx, slugs[1], body);
  }

  if (key === "GET inventory/analytics") {
    return getInventoryAnalytics(
      supabase,
      ctx,
      inventoryAnalyticsQuery.parse(Object.fromEntries(request.nextUrl.searchParams))
    );
  }

  if (key === "GET inventory/summary") {
    const analytics = await getInventoryAnalytics(supabase, ctx, { range: "30d" });
    return {
      totalProducts: analytics.totalProducts,
      activeProducts: analytics.activeProducts,
      totalStock: analytics.totalStock,
      lowStock: analytics.lowStock,
      outOfStock: analytics.outOfStock,
    };
  }

  if (key === "POST products/bulk") {
    return bulkUpdateProducts(supabase, ctx, productBulkUpdateSchema.parse(await request.json()));
  }

  if (method === "POST" && slugs[0] === "products" && slugs[1] && slugs[2] === "duplicate") {
    return duplicateProduct(supabase, ctx, slugs[1]);
  }

  if (method === "GET" && slugs[0] === "products" && slugs[1] && slugs[2] === "recommendations") {
    const product = await getProduct(supabase, ctx, slugs[1]);
    return {
      upsellProductIds: product.upsellProductIds ?? [],
      crossSellProductIds: product.crossSellProductIds ?? [],
    };
  }

  if (method === "PUT" && slugs[0] === "products" && slugs[1] && slugs[2] === "recommendations") {
    const body = productRecommendationsSchema.parse(await request.json());
    await getProduct(supabase, ctx, slugs[1]);
    return replaceProductRecommendations(supabase, ctx, slugs[1], body);
  }

  if (key === "GET inventory/categories") {
    return listCategories(supabase, ctx);
  }

  if (key === "POST inventory/categories") {
    return createCategory(supabase, ctx, categorySchema.parse(await request.json()));
  }

  if (key === "POST inventory/categories/reorder") {
    return reorderCategories(supabase, ctx, categoryReorderSchema.parse(await request.json()));
  }

  if (method === "PATCH" && slugs[0] === "inventory" && slugs[1] === "categories" && slugs[2]) {
    return updateCategory(supabase, ctx, slugs[2], categoryUpdateSchema.parse(await request.json()));
  }

  if (
    method === "POST" &&
    slugs[0] === "inventory" &&
    slugs[1] === "categories" &&
    slugs[2] &&
    slugs[3] === "image"
  ) {
    const form = await request.formData();
    const file = form.get("image") ?? form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Choose a category image to upload.");
    }
    return uploadCategoryImage(supabase, ctx, slugs[2], file);
  }

  if (
    method === "DELETE" &&
    slugs[0] === "inventory" &&
    slugs[1] === "categories" &&
    slugs[2] &&
    slugs[3] === "image"
  ) {
    return removeCategoryImage(supabase, ctx, slugs[2]);
  }

  if (method === "DELETE" && slugs[0] === "inventory" && slugs[1] === "categories" && slugs[2]) {
    return deleteCategory(supabase, ctx, slugs[2]);
  }

  if (key === "GET inventory/storefront") {
    return getStorefrontSettings(supabase, ctx);
  }

  if (key === "PATCH inventory/storefront") {
    return updateStorefrontSettings(supabase, ctx, storefrontSettingsSchema.parse(await request.json()));
  }

  if (key === "POST inventory/storefront/logo") {
    const form = await request.formData();
    const file = form.get("image") ?? form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Choose a logo to upload.");
    }
    return uploadStorefrontAsset(supabase, ctx, file, "logo");
  }

  if (key === "POST inventory/storefront/qr") {
    const form = await request.formData();
    const file = form.get("image") ?? form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Choose a QR image to upload.");
    }
    return uploadStorefrontAsset(supabase, ctx, file, "qr");
  }

  if (key === "POST inventory/storefront/slides") {
    const form = await request.formData();
    const file = form.get("image") ?? form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Choose a cover image to upload.");
    }
    return uploadStorefrontAsset(supabase, ctx, file, "slide");
  }

  if (method === "PATCH" && slugs[0] === "inventory" && slugs[1] === "storefront" && slugs[2] === "slides" && slugs[3]) {
    return updateStorefrontSlide(supabase, ctx, slugs[3], storefrontSlideSchema.parse(await request.json()));
  }

  if (
    method === "POST" &&
    slugs[0] === "inventory" &&
    slugs[1] === "storefront" &&
    slugs[2] === "slides" &&
    slugs[3] &&
    slugs[4] === "duplicate"
  ) {
    return duplicateStorefrontSlide(supabase, ctx, slugs[3]);
  }

  if (method === "DELETE" && slugs[0] === "inventory" && slugs[1] === "storefront" && slugs[2] === "slides" && slugs[3]) {
    return deleteStorefrontSlide(supabase, ctx, slugs[3]);
  }

  return null;
}
