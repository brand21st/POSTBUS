import { NextRequest } from "next/server";
import { requireTenant } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { apiRoute } from "@/lib/api/handler";
import { createServerSupabase } from "@/lib/supabase/server";
import { bannerMetaSchema, bannerUpdateSchema } from "@/modules/tracking-pages/schema";
import { addBanner, deleteBanner, updateBanners } from "@/modules/tracking-pages/service";

export const POST = apiRoute(async (request: NextRequest) => {
  const ctx = await requireTenant("tracking.pages");
  const supabase = await createServerSupabase();
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("image") ?? form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Choose an image to upload.");
    }
    const meta = bannerMetaSchema.parse({
      href: form.get("href") ? String(form.get("href")) : undefined,
      alt: form.get("alt") ? String(form.get("alt")) : undefined,
    });
    return addBanner(supabase, ctx, file, {
      href: meta.href ?? undefined,
      alt: meta.alt ?? undefined,
    });
  }

  const body = await request.json().catch(() => ({}));
  return updateBanners(supabase, ctx, bannerUpdateSchema.parse(body).banners);
});

export const DELETE = apiRoute(async (request: NextRequest) => {
  const ctx = await requireTenant("tracking.pages");
  const supabase = await createServerSupabase();
  const id = request.nextUrl.searchParams.get("id");
  if (!id) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Banner id is required.");
  return deleteBanner(supabase, ctx, id);
});
