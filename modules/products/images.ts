import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";

export const MAX_PRODUCT_IMAGES = 3;
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_BUCKET = "product-images";
export const ALLOWED_PRODUCT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

const PUBLIC_MARKER = `/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/`;

export function productImagePublicUrl(path: string | null | undefined) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}${PUBLIC_MARKER}${path}`;
}

export function productImageStoragePath(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return trimmed;
  const index = trimmed.indexOf(PUBLIC_MARKER);
  if (index < 0) return null;
  return decodeURIComponent(trimmed.slice(index + PUBLIC_MARKER.length).split("?")[0]);
}

export function mapProductImageUrls(paths: unknown) {
  const list = Array.isArray(paths) ? paths : [];
  const urls: string[] = [];
  const stored: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const path = productImageStoragePath(entry) ?? (entry.startsWith("http") ? null : entry.trim());
    if (!path) continue;
    stored.push(path);
    const url = productImagePublicUrl(path);
    if (url) urls.push(url);
    else urls.push(path);
  }
  return { imagePaths: stored.slice(0, MAX_PRODUCT_IMAGES), imageUrls: urls.slice(0, MAX_PRODUCT_IMAGES) };
}

export function productCoverImageUrl(paths: unknown) {
  return mapProductImageUrls(paths).imageUrls[0] ?? null;
}

function assertImageFile(file: File) {
  if (!ALLOWED_PRODUCT_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_PRODUCT_IMAGE_TYPES)[number])) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Upload a PNG, JPEG, or WebP photo.");
  }
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Product photos must be 5 MB or smaller.");
  }
}

function extensionFor(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName === "png" || fromName === "webp") return fromName;
  if (fromName === "jpg" || fromName === "jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function ownedPath(organizationId: string, productId: string, path: string) {
  return path.startsWith(`${organizationId}/${productId}/`);
}

async function loadImagePaths(supabase: SupabaseClient, ctx: TenantContext, productId: string) {
  const { data, error } = await supabase
    .from("products")
    .select("image_urls")
    .eq("organization_id", ctx.organizationId)
    .eq("id", productId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Product not found.");
  return mapProductImageUrls((data as { image_urls?: unknown }).image_urls).imagePaths;
}

async function saveImagePaths(
  supabase: SupabaseClient,
  ctx: TenantContext,
  productId: string,
  paths: string[]
) {
  const next = paths.slice(0, MAX_PRODUCT_IMAGES);
  const { error } = await supabase
    .from("products")
    .update({ image_urls: next })
    .eq("organization_id", ctx.organizationId)
    .eq("id", productId);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const { getProduct } = await import("@/modules/products/service");
  return getProduct(supabase, ctx, productId);
}

async function removeStorageObject(supabase: SupabaseClient, path: string) {
  await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]);
}

export async function uploadProductImage(
  supabase: SupabaseClient,
  ctx: TenantContext,
  productId: string,
  file: File,
  slot?: number
) {
  assertImageFile(file);
  const current = await loadImagePaths(supabase, ctx, productId);
  const replaceIndex =
    slot != null && Number.isInteger(slot) && slot >= 0 && slot < current.length ? slot : null;
  if (replaceIndex == null && current.length >= MAX_PRODUCT_IMAGES) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "You can add up to 3 product photos.");
  }

  const path = `${ctx.organizationId}/${productId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extensionFor(file)}`;
  const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type,
    cacheControl: "31536000",
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

  const next = [...current];
  if (replaceIndex != null) {
    const previous = next[replaceIndex];
    next[replaceIndex] = path;
    if (previous && previous !== path) await removeStorageObject(supabase, previous);
  } else {
    next.push(path);
  }
  return saveImagePaths(supabase, ctx, productId, next);
}

export async function removeProductImage(
  supabase: SupabaseClient,
  ctx: TenantContext,
  productId: string,
  slot: number
) {
  const current = await loadImagePaths(supabase, ctx, productId);
  if (!Number.isInteger(slot) || slot < 0 || slot >= current.length) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "That photo slot is empty.");
  }
  const [removed] = current.splice(slot, 1);
  if (removed && ownedPath(ctx.organizationId, productId, removed)) {
    await removeStorageObject(supabase, removed);
  }
  return saveImagePaths(supabase, ctx, productId, current);
}

export async function reorderProductImages(
  supabase: SupabaseClient,
  ctx: TenantContext,
  productId: string,
  urls: string[]
) {
  const current = await loadImagePaths(supabase, ctx, productId);
  const requested = urls
    .map((value) => productImageStoragePath(value))
    .filter((path): path is string => Boolean(path));
  const unique: string[] = [];
  for (const path of requested) {
    if (!current.includes(path) || unique.includes(path)) continue;
    unique.push(path);
  }
  if (!unique.length && requested.length) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Those photos do not belong to this product.");
  }
  const kept = unique;
  const dropped = current.filter((path) => !kept.includes(path));
  for (const path of dropped) {
    if (ownedPath(ctx.organizationId, productId, path)) await removeStorageObject(supabase, path);
  }
  return saveImagePaths(supabase, ctx, productId, kept);
}
