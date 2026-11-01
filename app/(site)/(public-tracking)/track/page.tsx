import type { Metadata } from "next";
import { headers } from "next/headers";
import { PostbusTrackPage } from "@/components/tracking-page/postbus-track-page";
import { PublicTrackingGate } from "@/components/tracking-page/public-tracking-gate";
import { PublicTrackingPage } from "@/components/tracking-page/public-tracking-page";
import { marketingMetadata, noIndexMetadata } from "@/lib/seo/metadata";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseTrackingSubdomain } from "@/modules/tracking-pages/host";
import { getPublishedTrackingPage } from "@/modules/tracking-pages/service";
import type { TrackingPageRecord } from "@/types/api";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const headerStore = await headers();
  const subdomain = parseTrackingSubdomain(headerStore.get("host"));
  if (subdomain) {
    return { title: "Shipment tracking", ...noIndexMetadata };
  }
  return marketingMetadata({
    title: "Track your shipment",
    description:
      "Track India Post shipments booked through PostBus. Enter your article number or barcode to see the latest scan events.",
    path: "/track",
    keywords: [
      "India Post tracking",
      "track shipment",
      "India Post article number",
      "PostBus tracking",
    ],
  });
}

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

  const initialQuery = query.tracking?.trim() ?? "";

  if (!subdomain) {
    return <PostbusTrackPage initialQuery={initialQuery} />;
  }

  let page: TrackingPageRecord | null = null;
  try {
    const supabase = await createServerSupabase();
    page = await getPublishedTrackingPage(supabase, subdomain);
  } catch {
    page = null;
  }

  if (!page) {
    return (
      <PublicTrackingGate
        subdomain={subdomain}
        hostname={headerStore.get("host") ?? `${subdomain}.postbus.in`}
      />
    );
  }
  return <PublicTrackingPage page={page} initialQuery={initialQuery} />;
}
