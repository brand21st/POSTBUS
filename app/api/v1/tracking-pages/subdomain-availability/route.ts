import { NextRequest } from "next/server";
import { requireTenant } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { createServerSupabase } from "@/lib/supabase/server";
import { assertTrackingPagePlan } from "@/modules/tracking-pages/assert-plan";
import { checkSubdomainAvailability } from "@/modules/tracking-pages/service";

export const GET = apiRoute(async (request: NextRequest) => {
  const ctx = await requireTenant();
  const supabase = await createServerSupabase();
  await assertTrackingPagePlan(supabase, ctx.organizationId);
  const subdomain = request.nextUrl.searchParams.get("subdomain") ?? "";
  return checkSubdomainAvailability(supabase, subdomain, ctx.organizationId);
});
