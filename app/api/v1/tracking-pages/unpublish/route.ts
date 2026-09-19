import { requireTenant } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { createServerSupabase } from "@/lib/supabase/server";
import { setTrackingPageStatus } from "@/modules/tracking-pages/service";

export const POST = apiRoute(async () => {
  const ctx = await requireTenant("tracking.pages");
  const supabase = await createServerSupabase();
  return setTrackingPageStatus(supabase, ctx, "DRAFT");
});
