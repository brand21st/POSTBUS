import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { z } from "zod";
import { PRODUCT_IMAGE_BUCKET, productImagePublicUrl } from "@/modules/products/images";
import type { categoryReorderSchema, categorySchema, categoryUpdateSchema } from "@/modules/products/schema";

type CreateCategory = z.infer<typeof categorySchema>;
type UpdateCategory = z.infer<typeof categoryUpdateSchema>;
type Reorder = z.infer<typeof categoryReorderSchema>;

function slugify(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "category";
}

export function mapCategory(row: Record<string, unknown>, productIds: string[] = []) {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description: (row.description as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    active: row.active !== false,
    imageUrl: productImagePublicUrl((row.image_path as string | null) ?? null),
    imagePath: (row.image_path as string | null) ?? null,
    productCount: productIds.length,
    productIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCategories(supabase: SupabaseClient, ctx: TenantContext) {
  const { data, error } = await supabase
    .from("product_categories")
    .select("id, organization_id, name, slug, description, sort_order, active, image_path, created_at, updated_at")
    .eq("organization_id", ctx.organizationId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const ids = (data ?? []).map((row) => String(row.id));
  const products = new Map<string, string[]>();
  if (ids.length) {
    const { data: members, error: memberError } = await supabase
      .from("product_category_members")
      .select("category_id, product_id")
      .eq("organization_id", ctx.organizationId)
      .in("category_id", ids);
    if (memberError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, memberError.message);
    for (const row of members ?? []) {
      const id = String(row.category_id);
      const current = products.get(id) ?? [];
      current.push(String(row.product_id));
      products.set(id, current);
    }
  }
  return (data ?? []).map((row) => mapCategory(row as Record<string, unknown>, products.get(String(row.id)) ?? []));
}

async function replaceCategoryProducts(
  supabase: SupabaseClient,
  ctx: TenantContext,
  categoryId: string,
  productIds: string[]
) {
  const unique = [...new Set(productIds)];
  if (unique.length) {
    const { count, error } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.organizationId)
      .in("id", unique);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    if ((count ?? 0) !== unique.length) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "One or more products were not found.");
    }
  }
  const { error: deleteError } = await supabase
    .from("product_category_members")
    .delete()
    .eq("organization_id", ctx.organizationId)
    .eq("category_id", categoryId);
  if (deleteError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, deleteError.message);
  if (!unique.length) return;
  const { error: insertError } = await supabase.from("product_category_members").insert(
    unique.map((productId) => ({
      organization_id: ctx.organizationId,
      category_id: categoryId,
      product_id: productId,
    }))
  );
  if (insertError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, insertError.message);
}

export async function createCategory(supabase: SupabaseClient, ctx: TenantContext, input: CreateCategory) {
  const { count } = await supabase
    .from("product_categories")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.organizationId);
  const { data, error } = await supabase
    .from("product_categories")
    .insert({
      organization_id: ctx.organizationId,
      name: input.name.trim(),
      slug: slugify(input.name),
      description: input.description?.trim() || null,
      active: input.active ?? true,
      sort_order: input.sortOrder ?? count ?? 0,
      image_path: input.imagePath ?? null,
    })
    .select("id, organization_id, name, slug, description, sort_order, active, image_path, created_at, updated_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new AppError(ERROR_CODES.CONFLICT, "A category with this name already exists.");
    }
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }
  if (input.productIds) await replaceCategoryProducts(supabase, ctx, String(data.id), input.productIds);
  return (await listCategories(supabase, ctx)).find((category) => category.id === String(data.id))
    ?? mapCategory(data as Record<string, unknown>, input.productIds ?? []);
}

export async function updateCategory(
  supabase: SupabaseClient,
  ctx: TenantContext,
  id: string,
  input: UpdateCategory
) {
  const patch: Record<string, unknown> = {};
  if (input.name != null) {
    patch.name = input.name.trim();
    patch.slug = slugify(input.name);
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.active != null) patch.active = input.active;
  if (input.sortOrder != null) patch.sort_order = input.sortOrder;
  if (input.imagePath !== undefined) patch.image_path = input.imagePath;
  if (input.productIds) await replaceCategoryProducts(supabase, ctx, id, input.productIds);
  if (!Object.keys(patch).length) {
    const category = (await listCategories(supabase, ctx)).find((item) => item.id === id);
    if (!category) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Category not found.");
    return category;
  }
  const { data, error } = await supabase
    .from("product_categories")
    .update(patch)
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .select("id, organization_id, name, slug, description, sort_order, active, image_path, created_at, updated_at")
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Category not found.");
  return (await listCategories(supabase, ctx)).find((category) => category.id === id)
    ?? mapCategory(data as Record<string, unknown>);
}

export async function deleteCategory(supabase: SupabaseClient, ctx: TenantContext, id: string) {
  const { data, error } = await supabase
    .from("product_categories")
    .delete()
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Category not found.");
  return { id };
}

export async function reorderCategories(supabase: SupabaseClient, ctx: TenantContext, input: Reorder) {
  for (const [index, id] of input.ids.entries()) {
    const { error } = await supabase
      .from("product_categories")
      .update({ sort_order: index })
      .eq("organization_id", ctx.organizationId)
      .eq("id", id);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }
  return listCategories(supabase, ctx);
}

async function getCategoryImagePath(
  supabase: SupabaseClient,
  ctx: TenantContext,
  id: string
) {
  const { data, error } = await supabase
    .from("product_categories")
    .select("image_path")
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Category not found.");
  return (data.image_path as string | null) ?? null;
}

export async function uploadCategoryImage(
  supabase: SupabaseClient,
  ctx: TenantContext,
  id: string,
  file: File
) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Upload a PNG, JPEG, or WebP image.");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Category images must be 5 MB or smaller.");
  }
  const previous = await getCategoryImagePath(supabase, ctx, id);
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${ctx.organizationId}/categories/${id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type,
    cacheControl: "31536000",
  });
  if (uploadError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, uploadError.message);
  const updated = await updateCategory(supabase, ctx, id, { imagePath: path });
  if (previous?.startsWith(`${ctx.organizationId}/categories/${id}/`)) {
    await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([previous]);
  }
  return updated;
}

export async function removeCategoryImage(
  supabase: SupabaseClient,
  ctx: TenantContext,
  id: string
) {
  const previous = await getCategoryImagePath(supabase, ctx, id);
  const updated = await updateCategory(supabase, ctx, id, { imagePath: null });
  if (previous?.startsWith(`${ctx.organizationId}/categories/${id}/`)) {
    await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([previous]);
  }
  return updated;
}
