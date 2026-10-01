import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";

export const TRACKING_HOST_LIVE_NOTIFICATION = "tracking.host_live";
export const TRACKING_HOST_LIVE_TITLE = "Tracking page is live";

function firstId(data: unknown): string | null {
  if (Array.isArray(data)) {
    const id = (data[0] as { id?: string } | undefined)?.id;
    return id ? String(id) : null;
  }
  const id = (data as { id?: string } | null)?.id;
  return id ? String(id) : null;
}

export async function notifyTrackingHostLive(
  supabase: SupabaseClient,
  input: { organizationId: string; trackingPageId: string; domain: string }
) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing, error: lookupError } = await supabase
    .from("notifications")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("type", TRACKING_HOST_LIVE_NOTIFICATION)
    .eq("entity_id", input.trackingPageId)
    .eq("body", input.domain)
    .gte("created_at", since)
    .limit(1);
  if (lookupError) {
    logError("TRACKING_HOST_LIVE_LOOKUP_FAILED", {
      organizationId: input.organizationId,
      message: lookupError.message,
    });
    return false;
  }
  if (firstId(existing)) return false;

  const { error } = await supabase.from("notifications").insert({
    organization_id: input.organizationId,
    type: TRACKING_HOST_LIVE_NOTIFICATION,
    title: TRACKING_HOST_LIVE_TITLE,
    body: input.domain,
    entity_type: "tracking_page",
    entity_id: input.trackingPageId,
  });
  if (error) {
    logError("TRACKING_HOST_LIVE_NOTIFICATION_FAILED", {
      organizationId: input.organizationId,
      message: error.message,
    });
    return false;
  }
  return true;
}
