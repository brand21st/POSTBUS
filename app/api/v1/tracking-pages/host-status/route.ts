import { NextRequest } from "next/server";
import { requireTenant } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { createServerSupabase } from "@/lib/supabase/server";
import { assertTrackingPagePlan } from "@/modules/tracking-pages/assert-plan";
import { checkPublishedTrackingHost } from "@/modules/tracking-pages/public-host";
import { getTrackingPage } from "@/modules/tracking-pages/service";

export const GET = apiRoute(async (request: NextRequest) => {
  const ctx = await requireTenant();
  const supabase = await createServerSupabase();
  await assertTrackingPagePlan(supabase, ctx.organizationId);
  const page = await getTrackingPage(supabase, ctx.organizationId);
  if (!page) {
    return {
      status: "unpublished" as const,
      domain: "",
      message: "Create a tracking page first.",
      notified: false,
    };
  }
  const announce = request.nextUrl.searchParams.get("announce") === "1";
  return checkPublishedTrackingHost(supabase, page, { announce });
});
