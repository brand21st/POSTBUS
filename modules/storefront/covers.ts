import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import type { z } from "zod";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { productImagePublicUrl } from "@/modules/products/images";
import type { storefrontCoverSchema } from "@/modules/storefront/schema";
import { parseSafeCoverHref } from "@/modules/storefront/schema";

import { MAX_ACTIVE_COVERS, type CoverRecord, coverLifecycle, eligibleCovers } from "@/modules/storefront/cover-model";
export { MAX_ACTIVE_COVERS, coverLifecycle, eligibleCovers };
export type { CoverRecord };
export const COVER_SELECT =
  "id, organization_id, image_path, mobile_image_path, name, title, subtitle, hook, description, cta_label, cta_href, offer_badge, discount_percent, cover_type, status, text_position, overlay_strength, text_color, desktop_focal, mobile_focal, image_meta, starts_at, ends_at, source_asset_id, ai_asset_id, festival, preset, sort_order, enabled, created_at, updated_at";
export const COVER_SELECT_LEGACY =
  "id, organization_id, image_path, title, subtitle, cta_label, cta_href, sort_order, enabled, created_at, updated_at";

function missingCoverColumn(message: string | undefined) {
  return Boolean(message && /column .* does not exist|schema cache/i.test(message));
}

export async function selectOrgCovers(supabase: SupabaseClient, organizationId: string, id?: string) {
  let query = supabase
    .from("storefront_slides")
    .select(COVER_SELECT)
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: true });
  if (id) query = query.eq("id", id);
  const full = id ? await query.maybeSingle() : await query;
  if (!full.error || !missingCoverColumn(full.error.message)) return full;
  let fallback = supabase
    .from("storefront_slides")
    .select(COVER_SELECT_LEGACY)
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: true });
  if (id) fallback = fallback.eq("id", id);
  return id ? fallback.maybeSingle() : fallback;
}

type CoverInput = z.infer<typeof storefrontCoverSchema>;


function focal(value: unknown): { x: number; y: number } {
  if (value && typeof value === "object" && "x" in value && "y" in value) {
    return { x: Number((value as { x: number }).x) || 50, y: Number((value as { y: number }).y) || 50 };
  }
  return { x: 50, y: 50 };
}

export function mapCover(row: Record<string, unknown>): CoverRecord {
  const meta = (row.image_meta && typeof row.image_meta === "object" ? row.image_meta : {}) as { luminance?: number };
  const status = String(row.status ?? "PUBLISHED") as CoverRecord["status"];
  return {
    id: String(row.id),
    name: (row.name as string | null) ?? null,
    imageUrl: productImagePublicUrl(String(row.image_path ?? "")) ?? "",
    imagePath: String(row.image_path ?? ""),
    mobileImageUrl: productImagePublicUrl(row.mobile_image_path as string | null),
    mobileImagePath: (row.mobile_image_path as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    subtitle: (row.subtitle as string | null) ?? null,
    hook: (row.hook as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    ctaLabel: (row.cta_label as string | null) ?? null,
    ctaHref: parseSafeCoverHref((row.cta_href as string | null) ?? null) ?? null,
    offerBadge: (row.offer_badge as string | null) ?? null,
    discountPercent: row.discount_percent == null ? null : Number(row.discount_percent),
    coverType: String(row.cover_type ?? "homepage_hero"),
    status,
    textPosition: (String(row.text_position ?? "left") as CoverRecord["textPosition"]),
    overlayStrength: Number(row.overlay_strength ?? 40),
    textColor: String(row.text_color ?? "#ffffff"),
    desktopFocal: focal(row.desktop_focal),
    mobileFocal: focal(row.mobile_focal),
    luminance: typeof meta.luminance === "number" ? meta.luminance : null,
    startsAt: row.starts_at ? String(row.starts_at) : null,
    endsAt: row.ends_at ? String(row.ends_at) : null,
    sourceAssetId: (row.source_asset_id as string | null) ?? null,
    aiAssetId: (row.ai_asset_id as string | null) ?? null,
    festival: (row.festival as string | null) ?? null,
    preset: (row.preset as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    enabled: row.enabled !== false,
  };
}

export async function imageLuminance(buffer: Buffer) {
  const stats = await sharp(buffer).stats();
  const r = (stats.channels[0]?.mean ?? 128) / 255;
  const g = (stats.channels[1]?.mean ?? 128) / 255;
  const b = (stats.channels[2]?.mean ?? 128) / 255;
  const lin = [r, g, b].map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
}

async function activeCount(supabase: SupabaseClient, organizationId: string, exceptId?: string) {
  let query = supabase
    .from("storefront_slides")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("status", ["DRAFT", "PUBLISHED"]);
  if (exceptId) query = query.neq("id", exceptId);
  const { count, error } = await query;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return count ?? 0;
}

export async function listCovers(supabase: SupabaseClient, ctx: TenantContext) {
  const { data, error } = await selectOrgCovers(supabase, ctx.organizationId);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows.map((row) => mapCover(row as Record<string, unknown>));
}

export async function getCover(supabase: SupabaseClient, ctx: TenantContext, id: string) {
  const { data, error } = await selectOrgCovers(supabase, ctx.organizationId, id);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Cover not found.");
  return mapCover(data as Record<string, unknown>);
}

function patchFromInput(input: CoverInput) {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name?.trim() || null;
  if (input.title !== undefined) patch.title = input.title;
  if (input.subtitle !== undefined) patch.subtitle = input.subtitle;
  if (input.hook !== undefined) patch.hook = input.hook;
  if (input.description !== undefined) patch.description = input.description;
  if (input.ctaLabel !== undefined) patch.cta_label = input.ctaLabel;
  if (input.ctaHref !== undefined) patch.cta_href = parseSafeCoverHref(input.ctaHref) ?? null;
  if (input.offerBadge !== undefined) patch.offer_badge = input.offerBadge;
  if (input.discountPercent !== undefined) patch.discount_percent = input.discountPercent;
  if (input.coverType !== undefined) patch.cover_type = input.coverType;
  if (input.status !== undefined) patch.status = input.status;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.textPosition !== undefined) patch.text_position = input.textPosition;
  if (input.overlayStrength !== undefined) patch.overlay_strength = input.overlayStrength;
  if (input.textColor !== undefined) patch.text_color = input.textColor;
  if (input.desktopFocal !== undefined) patch.desktop_focal = input.desktopFocal ?? { x: 50, y: 50 };
  if (input.mobileFocal !== undefined) patch.mobile_focal = input.mobileFocal ?? { x: 50, y: 50 };
  if (input.startsAt !== undefined) patch.starts_at = input.startsAt;
  if (input.endsAt !== undefined) patch.ends_at = input.endsAt;
  if (input.festival !== undefined) patch.festival = input.festival;
  if (input.preset !== undefined) patch.preset = input.preset;
  if (input.sourceAssetId !== undefined) patch.source_asset_id = input.sourceAssetId;
  if (input.aiAssetId !== undefined) patch.ai_asset_id = input.aiAssetId;
  if (input.desktopImagePath !== undefined && input.desktopImagePath) patch.image_path = input.desktopImagePath;
  if (input.mobileImagePath !== undefined) patch.mobile_image_path = input.mobileImagePath;
  return patch;
}

export async function createCover(
  supabase: SupabaseClient,
  ctx: TenantContext,
  input: CoverInput & { imagePath: string; imageMeta?: Record<string, unknown> }
) {
  if ((await activeCount(supabase, ctx.organizationId)) >= MAX_ACTIVE_COVERS) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "You can keep up to 8 active covers. Archive one first.");
  }
  const { count } = await supabase
    .from("storefront_slides")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.organizationId);
  const { data, error } = await supabase
    .from("storefront_slides")
    .insert({
      organization_id: ctx.organizationId,
      image_path: input.imagePath,
      image_meta: input.imageMeta ?? {},
      sort_order: count ?? 0,
      enabled: input.enabled ?? true,
      status: input.status ?? "DRAFT",
      ...patchFromInput(input),
    })
    .select(COVER_SELECT)
    .single();
  if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not create cover.");
  return mapCover(data as Record<string, unknown>);
}

export async function updateCover(supabase: SupabaseClient, ctx: TenantContext, id: string, input: CoverInput) {
  if (input.sortOrder !== undefined) {
    const { data: slides, error: listError } = await supabase
      .from("storefront_slides")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .order("sort_order", { ascending: true });
    if (listError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, listError.message);
    const ids = (slides ?? []).map((slide) => String(slide.id));
    const from = ids.indexOf(id);
    if (from < 0) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Cover not found.");
    const [moved] = ids.splice(from, 1);
    ids.splice(Math.max(0, Math.min(input.sortOrder, ids.length)), 0, moved);
    for (const [sortOrder, slideId] of ids.entries()) {
      const { error: reorderError } = await supabase
        .from("storefront_slides")
        .update({ sort_order: sortOrder })
        .eq("organization_id", ctx.organizationId)
        .eq("id", slideId);
      if (reorderError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, reorderError.message);
    }
  }
  const nextStatus = input.status;
  if (nextStatus === "DRAFT" || nextStatus === "PUBLISHED") {
    if ((await activeCount(supabase, ctx.organizationId, id)) >= MAX_ACTIVE_COVERS) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "You can keep up to 8 active covers. Archive one first.");
    }
  }
  const patch = patchFromInput(input);
  if (input.sortOrder !== undefined && Object.keys(patch).length === 0) {
    return getCover(supabase, ctx, id);
  }
  const { data, error } = await supabase
    .from("storefront_slides")
    .update(patch)
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Cover not found.");
  return getCover(supabase, ctx, id);
}

export async function duplicateCover(supabase: SupabaseClient, ctx: TenantContext, id: string) {
  const source = await getCover(supabase, ctx, id);
  if ((await activeCount(supabase, ctx.organizationId)) >= MAX_ACTIVE_COVERS) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "You can keep up to 8 active covers. Archive one first.");
  }
  return createCover(supabase, ctx, {
    imagePath: source.imagePath,
    name: source.name ? `${source.name} copy` : "Cover copy",
    title: source.title,
    subtitle: source.subtitle,
    hook: source.hook,
    description: source.description,
    ctaLabel: source.ctaLabel,
    ctaHref: source.ctaHref,
    offerBadge: source.offerBadge,
    discountPercent: source.discountPercent,
    coverType: source.coverType as CoverInput["coverType"],
    status: "DRAFT",
    enabled: false,
    textPosition: source.textPosition,
    overlayStrength: source.overlayStrength,
    textColor: source.textColor,
    desktopFocal: source.desktopFocal,
    mobileFocal: source.mobileFocal,
    mobileImagePath: source.mobileImagePath,
    festival: source.festival,
    preset: source.preset,
  });
}

export async function archiveCover(supabase: SupabaseClient, ctx: TenantContext, id: string) {
  return updateCover(supabase, ctx, id, { status: "ARCHIVED", enabled: false });
}

export async function uploadCoverImage(
  supabase: SupabaseClient,
  ctx: TenantContext,
  file: File,
  kind: "desktop" | "mobile",
  coverId?: string
) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Upload a PNG, JPEG, or WebP image.");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Images must be 5 MB or smaller.");
  }
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${ctx.organizationId}/storefront/cover-${kind}-${Date.now()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const luminance = await imageLuminance(bytes);
  const { error } = await supabase.storage.from("product-images").upload(path, bytes, {
    upsert: false,
    contentType: file.type,
    cacheControl: "31536000",
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!coverId) {
    return createCover(supabase, ctx, {
      imagePath: kind === "desktop" ? path : path,
      mobileImagePath: kind === "mobile" ? path : null,
      imageMeta: { luminance },
      status: "DRAFT",
    });
  }
  const patch: CoverInput = kind === "mobile" ? { mobileImagePath: path } : { desktopImagePath: path };
  const updated = await updateCover(supabase, ctx, coverId, patch);
  await supabase
    .from("storefront_slides")
    .update({ image_meta: { luminance } })
    .eq("id", coverId)
    .eq("organization_id", ctx.organizationId);
  return getCover(supabase, ctx, updated.id);
}

export async function applyGeneratedCoverAsset(
  supabase: SupabaseClient,
  ctx: TenantContext,
  coverId: string,
  input: { desktopPath?: string; mobilePath?: string; sourceAssetId?: string; aiAssetId?: string }
) {
  return updateCover(supabase, ctx, coverId, {
    desktopImagePath: input.desktopPath,
    mobileImagePath: input.mobilePath,
    sourceAssetId: input.sourceAssetId,
    aiAssetId: input.aiAssetId,
  });
}

export async function coverAnalytics(supabase: SupabaseClient, ctx: TenantContext, days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("storefront_events")
    .select("slide_id, event_type, device")
    .eq("organization_id", ctx.organizationId)
    .in("event_type", ["COVER_IMPRESSION", "COVER_CLICK"])
    .gte("created_at", since);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const bySlide: Record<string, { impressions: number; clicks: number; desktop: number; mobile: number }> = {};
  for (const row of data ?? []) {
    const id = String(row.slide_id ?? "");
    if (!id) continue;
    const current = bySlide[id] ?? { impressions: 0, clicks: 0, desktop: 0, mobile: 0 };
    if (row.event_type === "COVER_IMPRESSION") current.impressions += 1;
    if (row.event_type === "COVER_CLICK") current.clicks += 1;
    if (row.device === "desktop") current.desktop += 1;
    if (row.device === "mobile") current.mobile += 1;
    bySlide[id] = current;
  }
  return {
    days,
    note: "Engagement only — impressions and clicks are not conversion or sales.",
    covers: bySlide,
  };
}

