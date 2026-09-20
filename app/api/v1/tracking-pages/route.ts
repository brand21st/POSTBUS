import { NextRequest } from "next/server";
import { requireTenant } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { createServerSupabase } from "@/lib/supabase/server";
import { createTrackingPageSchema, updateTrackingPageSchema } from "@/modules/tracking-pages/schema";
import {
  createTrackingPage,
  getTrackingPage,
  updateTrackingPage,
  uploadLogo,
} from "@/modules/tracking-pages/service";

export const GET = apiRoute(async () => {
  const ctx = await requireTenant();
  const supabase = await createServerSupabase();
  return getTrackingPage(supabase, ctx.organizationId);
});

export const POST = apiRoute(async (request: NextRequest) => {
  const ctx = await requireTenant("tracking.pages");
  const body = await request.json().catch(() => ({}));
  const parsed = createTrackingPageSchema.parse(body);
  const supabase = await createServerSupabase();
  return createTrackingPage(supabase, ctx, parsed.subdomain, parsed.storeName);
});

export const PATCH = apiRoute(async (request: NextRequest) => {
  const ctx = await requireTenant("tracking.pages");
  const supabase = await createServerSupabase();
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const logo = form.get("logo");
    const raw = form.get("data");
    let page = raw
      ? await updateTrackingPage(
          supabase,
          ctx,
          updateTrackingPageSchema.parse(JSON.parse(String(raw)))
        )
      : await getTrackingPage(supabase, ctx.organizationId);
    if (logo instanceof File && logo.size > 0) {
      page = await uploadLogo(supabase, ctx, logo);
    }
    return page;
  }

  const body = await request.json().catch(() => ({}));
  return updateTrackingPage(supabase, ctx, updateTrackingPageSchema.parse(body));
});
