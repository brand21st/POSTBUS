import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { productImagePublicUrl } from "@/modules/products/images";
import { customerOrderLinkPath, customerOrderWorkspaceSlug } from "@/modules/customer-order-links/schema";
import type { z } from "zod";
import { assembleStoreFooter, normalizeStorefrontFooterConfig } from "@/modules/storefront/footer";
import { loadStoreFooterContext } from "@/modules/storefront/footer-context";
import type { storefrontSettingsSchema, storefrontSlideSchema } from "@/modules/storefront/schema";

type SettingsInput = z.infer<typeof storefrontSettingsSchema>;
type SlideInput = z.infer<typeof storefrontSlideSchema>;

const SLIDE_SELECT = "id, organization_id, image_path, title, subtitle, cta_label, cta_href, sort_order, enabled, created_at";
const MAX_SLIDES = 8;

export function mapSlide(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    imageUrl: productImagePublicUrl(String(row.image_path ?? "")) ?? "",
    imagePath: String(row.image_path ?? ""),
    title: (row.title as string | null) ?? null,
    subtitle: (row.subtitle as string | null) ?? null,
    ctaLabel: (row.cta_label as string | null) ?? null,
    ctaHref: (row.cta_href as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    enabled: row.enabled !== false,
  };
}

export async function storefrontPublicPath(supabase: SupabaseClient, organizationId: string) {
  const [{ data: org }, { data: link }] = await Promise.all([
    supabase.from("organizations").select("name, slug").eq("id", organizationId).maybeSingle(),
    supabase
      .from("customer_order_links")
      .select("public_workspace, public_code")
      .eq("organization_id", organizationId)
      .eq("status", "ACTIVE")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const workspace =
    (link?.public_workspace as string | undefined) ||
    customerOrderWorkspaceSlug((org?.name as string) ?? "store", org?.slug as string | null);
  const publicId = (link?.public_code as string | undefined) ?? "";
  const storePath = `/store/${workspace}`;
  const legacyPath = publicId ? customerOrderLinkPath(workspace, publicId) : storePath;
  const origin = env.appUrl.replace(/\/$/, "");
  return {
    workspace,
    publicId: publicId || null,
    storePath,
    legacyPath,
    storeUrl: `${origin}${storePath}`,
    legacyUrl: `${origin}${legacyPath}`,
  };
}

export async function getStorefrontSettings(supabase: SupabaseClient, ctx: TenantContext) {
  const [{ data: settings }, { data: slides }, link] = await Promise.all([
    supabase.from("storefront_settings").select("*").eq("organization_id", ctx.organizationId).maybeSingle(),
    supabase
      .from("storefront_slides")
      .select(SLIDE_SELECT)
      .eq("organization_id", ctx.organizationId)
      .order("sort_order", { ascending: true }),
    storefrontPublicPath(supabase, ctx.organizationId),
  ]);
  const { data: org } = await supabase.from("organizations").select("name").eq("id", ctx.organizationId).maybeSingle();
  const storeName = (settings?.store_name as string | null) || (org?.name as string | null) || "Store";
  const logoUrl = productImagePublicUrl(settings?.logo_path as string | null);
  const accentColor = (settings?.accent_color as string | null) || "#E11D48";
  const seoDescription = (settings?.seo_description as string | null) ?? null;
  const footerConfig = normalizeStorefrontFooterConfig(settings?.footer);
  const [{ data: categories }, footerContext] = await Promise.all([
    supabase
      .from("product_categories")
      .select("name, slug, active")
      .eq("organization_id", ctx.organizationId)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    loadStoreFooterContext(supabase, ctx.organizationId),
  ]);
  const mappedCategories = (categories ?? []).map((row) => ({ name: String(row.name), slug: String(row.slug) }));
  const footerSources = {
    organization: footerContext.organization,
    email: footerContext.email,
    payments: footerContext.payments,
    policies: {
      privacyPolicyBody: footerContext.policies.privacyPolicyBody.trim() ? "." : "",
      privacyPolicyEnabled: footerContext.policies.privacyPolicyEnabled,
      termsBody: footerContext.policies.termsBody.trim() ? "." : "",
      termsEnabled: footerContext.policies.termsEnabled,
      shippingPolicyBody: footerContext.policies.shippingPolicyBody.trim() ? "." : "",
      shippingPolicyEnabled: footerContext.policies.shippingPolicyEnabled,
      returnsBody: footerContext.policies.returnsBody.trim() ? "." : "",
      returnsEnabled: footerContext.policies.returnsEnabled,
    },
  };
  const footerPreview = assembleStoreFooter(footerConfig, {
    storeName,
    logoUrl,
    tagline: seoDescription,
    accentColor,
    workspace: link.workspace,
    organization: footerContext.organization,
    email: footerContext.email,
    policies: footerContext.policies,
    categories: mappedCategories,
    hasProducts: true,
    hasBestSellers: true,
    payments: footerContext.payments,
  });
  return {
    storeName,
    logoUrl,
    logoPath: (settings?.logo_path as string | null) ?? null,
    accentColor,
    published: settings?.published !== false,
    seoTitle: (settings?.seo_title as string | null) ?? null,
    seoDescription,
    featuredProductIds: Array.isArray(settings?.featured_product_ids)
      ? (settings?.featured_product_ids as string[])
      : [],
    slides: (slides ?? []).map((row) => mapSlide(row as Record<string, unknown>)),
    footer: footerConfig,
    footerPreview,
    footerSources,
    ...link,
  };
}

export async function updateStorefrontSettings(
  supabase: SupabaseClient,
  ctx: TenantContext,
  input: SettingsInput
) {
  const patch: Record<string, unknown> = {
    organization_id: ctx.organizationId,
  };
  if (input.storeName !== undefined) patch.store_name = input.storeName?.trim() || null;
  if (input.accentColor !== undefined) patch.accent_color = input.accentColor;
  if (input.published !== undefined) patch.published = input.published;
  if (input.seoTitle !== undefined) patch.seo_title = input.seoTitle?.trim() || null;
  if (input.seoDescription !== undefined) patch.seo_description = input.seoDescription?.trim() || null;
  if (input.footer !== undefined) patch.footer = normalizeStorefrontFooterConfig(input.footer);
  if (input.featuredProductIds) {
    const unique = [...new Set(input.featuredProductIds)];
    if (unique.length) {
      const { count, error: featuredError } = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", ctx.organizationId)
        .in("id", unique);
      if (featuredError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, featuredError.message);
      if ((count ?? 0) !== unique.length) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, "One or more featured products were not found.");
      }
    }
    patch.featured_product_ids = unique;
  }
  const { error } = await supabase.from("storefront_settings").upsert(patch, { onConflict: "organization_id" });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return getStorefrontSettings(supabase, ctx);
}

export async function uploadStorefrontAsset(
  supabase: SupabaseClient,
  ctx: TenantContext,
  file: File,
  kind: "logo" | "slide"
) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Upload a PNG, JPEG, or WebP image.");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Images must be 5 MB or smaller.");
  }
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${ctx.organizationId}/storefront/${kind}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("product-images").upload(path, file, {
    upsert: false,
    contentType: file.type,
    cacheControl: "31536000",
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

  if (kind === "logo") {
    const { error: upsertError } = await supabase.from("storefront_settings").upsert(
      { organization_id: ctx.organizationId, logo_path: path },
      { onConflict: "organization_id" }
    );
    if (upsertError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, upsertError.message);
    return getStorefrontSettings(supabase, ctx);
  }

  const { count } = await supabase
    .from("storefront_slides")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.organizationId);
  if ((count ?? 0) >= MAX_SLIDES) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "You can add up to 8 cover slides.");
  }
  const { error: insertError } = await supabase.from("storefront_slides").insert({
    organization_id: ctx.organizationId,
    image_path: path,
    sort_order: count ?? 0,
    enabled: true,
  });
  if (insertError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, insertError.message);
  return getStorefrontSettings(supabase, ctx);
}

export async function updateStorefrontSlide(
  supabase: SupabaseClient,
  ctx: TenantContext,
  id: string,
  input: SlideInput
) {
  if (input.sortOrder !== undefined) {
    const { data: slides, error: listError } = await supabase
      .from("storefront_slides")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .order("sort_order", { ascending: true });
    if (listError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, listError.message);
    const ids = (slides ?? []).map((slide) => String(slide.id));
    const from = ids.indexOf(id);
    if (from < 0) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Slide not found.");
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
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.subtitle !== undefined) patch.subtitle = input.subtitle;
  if (input.ctaLabel !== undefined) patch.cta_label = input.ctaLabel;
  if (input.ctaHref !== undefined) patch.cta_href = input.ctaHref;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.sortOrder !== undefined && Object.keys(patch).length === 0) {
    return getStorefrontSettings(supabase, ctx);
  }
  const { data, error } = await supabase
    .from("storefront_slides")
    .update(patch)
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Slide not found.");
  return getStorefrontSettings(supabase, ctx);
}

export async function duplicateStorefrontSlide(
  supabase: SupabaseClient,
  ctx: TenantContext,
  id: string
) {
  const [{ data: source, error: sourceError }, { count }] = await Promise.all([
    supabase
      .from("storefront_slides")
      .select("image_path, title, subtitle, cta_label, cta_href, enabled")
      .eq("organization_id", ctx.organizationId)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("storefront_slides")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.organizationId),
  ]);
  if (sourceError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, sourceError.message);
  if (!source) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Slide not found.");
  if ((count ?? 0) >= MAX_SLIDES) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "You can add up to 8 cover slides.");
  }
  const { error } = await supabase.from("storefront_slides").insert({
    organization_id: ctx.organizationId,
    image_path: source.image_path,
    title: source.title,
    subtitle: source.subtitle,
    cta_label: source.cta_label,
    cta_href: source.cta_href,
    enabled: source.enabled,
    sort_order: count ?? 0,
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return getStorefrontSettings(supabase, ctx);
}

export async function deleteStorefrontSlide(supabase: SupabaseClient, ctx: TenantContext, id: string) {
  const { data, error } = await supabase
    .from("storefront_slides")
    .delete()
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Slide not found.");
  return getStorefrontSettings(supabase, ctx);
}

export async function inventorySummary(supabase: SupabaseClient, ctx: TenantContext) {
  const org = ctx.organizationId;
  const [all, active, out, low] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", org),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("active", true),
    supabase
      .from("inventory_balances")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("on_hand", 0),
    supabase
      .from("inventory_balances")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .gt("on_hand", 0)
      .lte("on_hand", 5),
  ]);
  const { data: stockRows } = await supabase
    .from("inventory_balances")
    .select("on_hand")
    .eq("organization_id", org);
  const totalStock = (stockRows ?? []).reduce((sum, row) => sum + Number(row.on_hand ?? 0), 0);
  return {
    totalProducts: all.count ?? 0,
    activeProducts: active.count ?? 0,
    totalStock,
    lowStock: low.count ?? 0,
    outOfStock: out.count ?? 0,
  };
}
