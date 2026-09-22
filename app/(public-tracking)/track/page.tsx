import { headers } from "next/headers";
import { PublicTrackingPage } from "@/components/tracking-page/public-tracking-page";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseTrackingSubdomain } from "@/modules/tracking-pages/host";
import { getPublishedTrackingPage } from "@/modules/tracking-pages/service";
import type { TrackingPageRecord } from "@/types/api";

export const dynamic = "force-dynamic";

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ subdomain?: string; tracking?: string }>;
}) {
  const headerStore = await headers();
  const query = await searchParams;
  const subdomain =
    headerStore.get("x-tracking-subdomain") ||
    parseTrackingSubdomain(headerStore.get("host")) ||
    query.subdomain ||
    null;

  if (!subdomain) {
    return <PublicTrackingPage unavailable />;
  }

  let page: TrackingPageRecord | null = null;
  try {
    const supabase = await createServerSupabase();
    page = await getPublishedTrackingPage(supabase, subdomain);
  } catch {
    page = null;
  }

  if (!page) return <PublicTrackingPage unavailable />;
  return <PublicTrackingPage page={page} initialQuery={query.tracking?.trim() ?? ""} />;
}
