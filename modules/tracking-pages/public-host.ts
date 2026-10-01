import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyTrackingHostLive } from "@/lib/notifications/tracking-host";
import { trackingPagePublicUrl } from "./host";

export type PublicHostStatus = "live" | "connecting" | "unpublished";

export type TrackingHostStatus = {
  status: PublicHostStatus;
  domain: string;
  message: string;
  notified: boolean;
};

export async function probePublicTrackingHost(domain: string) {
  if (!domain.startsWith("http://") && !domain.startsWith("https://")) return false;
  try {
    const response = await fetch(`${domain.replace(/\/$/, "")}/`, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(8000),
    });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

export async function checkPublishedTrackingHost(
  supabase: SupabaseClient,
  page: { id: string; organizationId: string; subdomain: string; status: string },
  options?: { announce?: boolean }
): Promise<TrackingHostStatus> {
  const domain = trackingPagePublicUrl(page.subdomain);
  if (page.status !== "PUBLISHED") {
    return {
      status: "unpublished",
      domain,
      message: "Publish the tracking page to open this address for customers.",
      notified: false,
    };
  }

  const live = await probePublicTrackingHost(domain);
  if (!live) {
    return {
      status: "connecting",
      domain,
      message: `${domain} is connecting. It is usually live within a minute.`,
      notified: false,
    };
  }

  const notified =
    options?.announce === true
      ? await notifyTrackingHostLive(supabase, {
          organizationId: page.organizationId,
          trackingPageId: page.id,
          domain,
        })
      : false;
  return {
    status: "live",
    domain,
    message: `${domain} is live for customers.`,
    notified,
  };
}
