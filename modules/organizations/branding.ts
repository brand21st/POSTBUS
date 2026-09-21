import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import type { OrganizationSettings } from "@/types/api";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const BUCKET = "organization-assets";

export type OrganizationIdentityRow = {
  id: string;
  name: string;
  slug?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  logo_path?: string | null;
};

export function organizationLogoUrl(path: string | null | undefined) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

export function mapOrganizationSettings(row: OrganizationIdentityRow): OrganizationSettings {
  const logoUrl = organizationLogoUrl(row.logo_path);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug ?? null,
    phone: row.phone ?? null,
    line1: row.line1 ?? null,
    line2: row.line2 ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    pincode: row.pincode ?? null,
    logoPath: row.logo_path ?? null,
    logo_path: row.logo_path ?? null,
    logoUrl,
    logo_url: logoUrl,
  };
}

function extensionFor(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName === "png" || fromName === "webp") return fromName;
  if (fromName === "jpg" || fromName === "jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

export async function uploadOrganizationLogo(
  supabase: SupabaseClient,
  ctx: TenantContext,
  file: File
) {
  if (!ALLOWED_LOGO_TYPES.includes(file.type as (typeof ALLOWED_LOGO_TYPES)[number])) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Upload a PNG, JPEG, or WebP logo.");
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Logos must be 5 MB or smaller.");
  }
  const path = `${ctx.organizationId}/logo-${Date.now()}.${extensionFor(file)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type,
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return path;
}
