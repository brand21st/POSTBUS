import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import {
  ALLOWED_IMAGE_TYPES,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_PRIMARY_COLOR,
  MAX_BANNERS,
  MAX_UPLOAD_BYTES,
} from "./constants";
import { classifySubdomain, publicObjectUrl, trackingPagePublicUrl } from "./host";
import type { UpdateTrackingPageInput } from "./schema";
import type { TrackingPageBanner, TrackingPageRecord, TrackingPageSocial } from "@/types/api";

type TrackingPageRow = {
  id: string;
  organization_id: string;
  subdomain: string;
  status: TrackingPageRecord["status"];
  store_name: string;
  tagline: string | null;
  about: string | null;
  logo_path: string | null;
  primary_color: string;
  background_color: string;
  location_name: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  map_url: string | null;
  social: TrackingPageSocial | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type BannerRow = {
  id: string;
  image_path: string;
  href: string | null;
  alt: string | null;
  sort_order: number;
  enabled: boolean;
};

function mapBanner(row: BannerRow): TrackingPageBanner {
  return {
    id: row.id,
    imagePath: row.image_path,
    imageUrl: publicObjectUrl(row.image_path),
    href: row.href,
    alt: row.alt,
    sortOrder: row.sort_order,
    enabled: row.enabled,
  };
}

export function mapTrackingPage(row: TrackingPageRow, banners: BannerRow[] = []): TrackingPageRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    subdomain: row.subdomain,
    status: row.status,
    storeName: row.store_name,
    tagline: row.tagline,
    about: row.about,
    logoPath: row.logo_path,
    logoUrl: publicObjectUrl(row.logo_path),
    primaryColor: row.primary_color,
    backgroundColor: row.background_color,
    locationName: row.location_name,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    phone: row.phone,
    email: row.email,
    whatsapp: row.whatsapp,
    mapUrl: row.map_url,
    social: row.social ?? {},
    banners: banners.map(mapBanner),
    publishedAt: row.published_at,
    publicUrl: trackingPagePublicUrl(row.subdomain),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadBanners(supabase: SupabaseClient, pageId: string) {
  const { data, error } = await supabase
    .from("tracking_page_banners")
    .select("id, image_path, href, alt, sort_order, enabled")
    .eq("tracking_page_id", pageId)
    .order("sort_order", { ascending: true });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return (data ?? []) as BannerRow[];
}

export async function getTrackingPage(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase
    .from("tracking_pages")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) return null;
  const banners = await loadBanners(supabase, data.id);
  return mapTrackingPage(data as TrackingPageRow, banners);
}

export async function getPublishedTrackingPage(supabase: SupabaseClient, subdomain: string) {
  const { data, error } = await supabase
    .from("tracking_pages")
    .select("*")
    .eq("subdomain", subdomain)
    .eq("status", "PUBLISHED")
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) return null;
  const { data: banners, error: bannerError } = await supabase
    .from("tracking_page_banners")
    .select("id, image_path, href, alt, sort_order, enabled")
    .eq("tracking_page_id", data.id)
    .eq("enabled", true)
    .order("sort_order", { ascending: true });
  if (bannerError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, bannerError.message);
  return mapTrackingPage(data as TrackingPageRow, (banners ?? []) as BannerRow[]);
}

export async function checkSubdomainAvailability(
  supabase: SupabaseClient,
  subdomainRaw: string,
  organizationId?: string
) {
  const classified = classifySubdomain(subdomainRaw);
  if (classified.reason === "invalid") {
    return { available: false, reason: "invalid" as const };
  }
  if (classified.reason === "reserved") {
    return { available: false, reason: "reserved" as const };
  }

  const reader = hasAdminClient() ? createAdminClient() : supabase;
  const { data, error } = await reader
    .from("tracking_pages")
    .select("id, organization_id")
    .eq("subdomain", classified.subdomain)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (data && data.organization_id !== organizationId) {
    return { available: false, reason: "taken" as const };
  }
  return { available: true, reason: "available" as const };
}

async function firstPickupLocation(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("pickup_locations")
    .select("name, phone, email, line1, line2, city, state, pincode")
    .eq("organization_id", organizationId)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function createTrackingPage(
  supabase: SupabaseClient,
  ctx: TenantContext,
  subdomain: string,
  storeName?: string
) {
  const existing = await getTrackingPage(supabase, ctx.organizationId);
  if (existing) {
    throw new AppError(ERROR_CODES.CONFLICT, "This workspace already has a tracking page.");
  }

  const availability = await checkSubdomainAvailability(supabase, subdomain);
  if (!availability.available) {
    const message =
      availability.reason === "taken"
        ? "That subdomain is already taken."
        : availability.reason === "reserved"
          ? "That subdomain is reserved."
          : "Enter a valid subdomain.";
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, message);
  }

  const pickup = await firstPickupLocation(supabase, ctx.organizationId);
  const { data, error } = await supabase
    .from("tracking_pages")
    .insert({
      organization_id: ctx.organizationId,
      subdomain,
      store_name: storeName?.trim() || ctx.organizationName,
      primary_color: DEFAULT_PRIMARY_COLOR,
      background_color: DEFAULT_BACKGROUND_COLOR,
      location_name: pickup?.name ?? ctx.organizationName,
      line1: pickup?.line1 ?? null,
      line2: pickup?.line2 ?? null,
      city: pickup?.city ?? null,
      state: pickup?.state ?? null,
      pincode: pickup?.pincode ?? null,
      phone: pickup?.phone ?? null,
      email: pickup?.email ?? null,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new AppError(ERROR_CODES.CONFLICT, "That subdomain is already taken.");
    }
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }

  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "tracking_page.created",
    entity_type: "tracking_page",
    entity_id: data.id,
  });

  return mapTrackingPage(data as TrackingPageRow);
}

export async function updateTrackingPage(
  supabase: SupabaseClient,
  ctx: TenantContext,
  input: UpdateTrackingPageInput
) {
  const page = await getTrackingPage(supabase, ctx.organizationId);
  if (!page) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Create a tracking page first.");

  if (input.subdomain && input.subdomain !== page.subdomain) {
    const availability = await checkSubdomainAvailability(supabase, input.subdomain, ctx.organizationId);
    if (!availability.available) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "That subdomain is not available.");
    }
  }

  const payload: Record<string, unknown> = {};
  if (input.subdomain) payload.subdomain = input.subdomain;
  if (input.storeName) payload.store_name = input.storeName;
  if (input.tagline !== undefined) payload.tagline = input.tagline ?? null;
  if (input.about !== undefined) payload.about = input.about ?? null;
  if (input.primaryColor) payload.primary_color = input.primaryColor;
  if (input.backgroundColor) payload.background_color = input.backgroundColor;
  if (input.locationName !== undefined) payload.location_name = input.locationName ?? null;
  if (input.line1 !== undefined) payload.line1 = input.line1 ?? null;
  if (input.line2 !== undefined) payload.line2 = input.line2 ?? null;
  if (input.city !== undefined) payload.city = input.city ?? null;
  if (input.state !== undefined) payload.state = input.state ?? null;
  if (input.pincode !== undefined) payload.pincode = input.pincode ?? null;
  if (input.phone !== undefined) payload.phone = input.phone ?? null;
  if (input.email !== undefined) payload.email = input.email ?? null;
  if (input.whatsapp !== undefined) payload.whatsapp = input.whatsapp ?? null;
  if (input.mapUrl !== undefined) payload.map_url = input.mapUrl ?? null;
  if (input.social) {
    payload.social = {
      ...page.social,
      ...Object.fromEntries(
        Object.entries(input.social).map(([key, value]) => [key, value ?? null])
      ),
    };
  }

  if (Object.keys(payload).length === 0) {
    return getTrackingPage(supabase, ctx.organizationId);
  }

  const { data, error } = await supabase
    .from("tracking_pages")
    .update(payload)
    .eq("id", page.id)
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new AppError(ERROR_CODES.CONFLICT, "That subdomain is already taken.");
    }
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }

  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "tracking_page.updated",
    entity_type: "tracking_page",
    entity_id: page.id,
  });

  const banners = await loadBanners(supabase, page.id);
  return mapTrackingPage(data as TrackingPageRow, banners);
}

export async function setTrackingPageStatus(
  supabase: SupabaseClient,
  ctx: TenantContext,
  status: "PUBLISHED" | "DRAFT"
) {
  const page = await getTrackingPage(supabase, ctx.organizationId);
  if (!page) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Create a tracking page first.");

  const { data, error } = await supabase
    .from("tracking_pages")
    .update({
      status,
      published_at: status === "PUBLISHED" ? new Date().toISOString() : page.publishedAt,
    })
    .eq("id", page.id)
    .select("*")
    .single();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: status === "PUBLISHED" ? "tracking_page.published" : "tracking_page.unpublished",
    entity_type: "tracking_page",
    entity_id: page.id,
  });

  const banners = await loadBanners(supabase, page.id);
  return mapTrackingPage(data as TrackingPageRow, banners);
}

function assertImageFile(file: File) {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Upload a PNG, JPEG, WebP, or SVG image.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Images must be 5 MB or smaller.");
  }
}

function extensionFor(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && ["png", "jpg", "jpeg", "webp", "svg"].includes(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/svg+xml") return "svg";
  return "jpg";
}

export async function uploadLogo(supabase: SupabaseClient, ctx: TenantContext, file: File) {
  const page = await getTrackingPage(supabase, ctx.organizationId);
  if (!page) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Create a tracking page first.");
  assertImageFile(file);
  const path = `${ctx.organizationId}/logo-${Date.now()}.${extensionFor(file)}`;
  const { error } = await supabase.storage.from("tracking-pages").upload(path, file, {
    upsert: true,
    contentType: file.type,
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

  const { data, error: updateError } = await supabase
    .from("tracking_pages")
    .update({ logo_path: path })
    .eq("id", page.id)
    .select("*")
    .single();
  if (updateError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, updateError.message);
  const banners = await loadBanners(supabase, page.id);
  return mapTrackingPage(data as TrackingPageRow, banners);
}

export async function addBanner(
  supabase: SupabaseClient,
  ctx: TenantContext,
  file: File,
  meta: { href?: string; alt?: string }
) {
  const page = await getTrackingPage(supabase, ctx.organizationId);
  if (!page) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Create a tracking page first.");
  if (page.banners.length >= MAX_BANNERS) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "You can add up to 3 ad banners.");
  }
  assertImageFile(file);
  const id = crypto.randomUUID();
  const path = `${ctx.organizationId}/banners/${id}.${extensionFor(file)}`;
  const { error } = await supabase.storage.from("tracking-pages").upload(path, file, {
    upsert: false,
    contentType: file.type,
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

  const { data, error: insertError } = await supabase
    .from("tracking_page_banners")
    .insert({
      organization_id: ctx.organizationId,
      tracking_page_id: page.id,
      sort_order: page.banners.length,
      image_path: path,
      href: meta.href ?? null,
      alt: meta.alt ?? null,
      enabled: true,
    })
    .select("id, image_path, href, alt, sort_order, enabled")
    .single();
  if (insertError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, insertError.message);
  return mapBanner(data as BannerRow);
}

export async function updateBanners(
  supabase: SupabaseClient,
  ctx: TenantContext,
  banners: Array<{
    id: string;
    href?: string | null;
    alt?: string | null;
    sortOrder?: number;
    enabled?: boolean;
  }>
) {
  const page = await getTrackingPage(supabase, ctx.organizationId);
  if (!page) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Create a tracking page first.");

  for (const banner of banners) {
    const payload: Record<string, unknown> = {};
    if (banner.href !== undefined) payload.href = banner.href;
    if (banner.alt !== undefined) payload.alt = banner.alt;
    if (banner.sortOrder !== undefined) payload.sort_order = banner.sortOrder;
    if (banner.enabled !== undefined) payload.enabled = banner.enabled;
    if (Object.keys(payload).length === 0) continue;
    const { error } = await supabase
      .from("tracking_page_banners")
      .update(payload)
      .eq("id", banner.id)
      .eq("organization_id", ctx.organizationId);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }

  return getTrackingPage(supabase, ctx.organizationId);
}

export async function deleteBanner(supabase: SupabaseClient, ctx: TenantContext, bannerId: string) {
  const page = await getTrackingPage(supabase, ctx.organizationId);
  if (!page) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Create a tracking page first.");
  const banner = page.banners.find((item) => item.id === bannerId);
  if (!banner) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Banner not found.");

  const { error } = await supabase
    .from("tracking_page_banners")
    .delete()
    .eq("id", bannerId)
    .eq("organization_id", ctx.organizationId);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (banner.imagePath) {
    await supabase.storage.from("tracking-pages").remove([banner.imagePath]);
  }
  return getTrackingPage(supabase, ctx.organizationId);
}

