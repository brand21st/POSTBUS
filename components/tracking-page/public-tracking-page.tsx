"use client";

import { useState } from "react";
import { Radio } from "lucide-react";
import { BannerAds } from "@/components/tracking-page/banner-ads";
import { StoreLocationCard } from "@/components/tracking-page/store-location-card";
import { TrackingTimeline } from "@/components/tracking-page/tracking-timeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { api, ApiError } from "@/lib/hooks/use-api";
import type { PublicTrackResult, TrackingPageRecord } from "@/types/api";

export function PublicTrackingPage({
  page,
  unavailable = false,
  preview = false,
  lookupEnabled = true,
  compact = false,
}: {
  page?: TrackingPageRecord | null;
  unavailable?: boolean;
  preview?: boolean;
  lookupEnabled?: boolean;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicTrackResult | null>(null);

  const accent = page?.primaryColor || "#E11D48";
  const background = page?.backgroundColor || "#FFFFFF";

  async function onTrack(event: React.FormEvent) {
    event.preventDefault();
    if (!lookupEnabled || preview) {
      setError(preview ? "Publish the page to look up live shipments from this preview." : null);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await api<PublicTrackResult>("/api/v1/public/track", {
        method: "POST",
        body: JSON.stringify({ query: query.trim(), subdomain: page?.subdomain }),
      });
      setResult(data);
      if (!data.found) {
        setError("No shipment found for that tracking number.");
      }
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setLoading(false);
    }
  }

  if (unavailable || !page) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
        <Radio className="mb-4 size-8 text-muted" />
        <h1 className="text-2xl font-semibold text-ink">This tracking page is not available</h1>
        <p className="mt-2 max-w-md text-sm text-muted">
          The store has not published a tracking page at this address, or the address is incorrect.
        </p>
      </div>
    );
  }

  return (
    <div className={compact ? "min-h-0" : "min-h-screen"} style={{ backgroundColor: background, color: "#18181b" }}>
      <div className={`mx-auto flex max-w-3xl flex-col px-4 py-10 sm:px-6 ${compact ? "min-h-0" : "min-h-screen"}`}>
        <header className="flex flex-col items-center text-center">
          {page.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={page.logoUrl} alt={page.storeName} className="mb-4 h-16 w-16 rounded-2xl object-cover" />
          ) : (
            <div
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl text-lg font-bold text-white"
              style={{ backgroundColor: accent }}
            >
              {page.storeName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <h1 className="text-3xl font-semibold tracking-tight">{page.storeName}</h1>
          {page.tagline ? <p className="mt-2 text-sm opacity-70">{page.tagline}</p> : null}
          {page.about ? <p className="mt-4 max-w-xl text-sm leading-relaxed opacity-80">{page.about}</p> : null}
        </header>

        <form onSubmit={onTrack} className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Enter barcode or India Post article number"
            className="flex-1 bg-white"
            minLength={6}
            required
          />
          <Button type="submit" disabled={loading || !lookupEnabled} style={{ backgroundColor: accent }}>
            {loading ? "Tracking…" : "Track"}
          </Button>
        </form>

        {error ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        ) : null}

        {result?.found && result.shipment ? (
          <section className="mt-6 rounded-2xl border border-black/10 bg-white/90 p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">
                  {result.shipment.barcode ?? result.shipment.trackingNumber}
                </p>
                <p className="mt-1 text-sm opacity-70">
                  Order {result.shipment.orderNumber ?? "—"}
                  {result.shipment.destinationCity
                    ? ` · ${result.shipment.destinationCity}${result.shipment.destinationState ? `, ${result.shipment.destinationState}` : ""}`
                    : ""}
                </p>
              </div>
              <StatusBadge value={result.shipment.status} />
            </div>
            {result.liveTracking !== "ok" ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {result.liveMessage ||
                  (result.liveTracking === "not_connected"
                    ? "India Post is not connected."
                    : "Live tracking unavailable.")}
              </p>
            ) : null}
            <div className="mt-5" style={{ color: accent }}>
              <TrackingTimeline events={result.shipment.events} />
            </div>
          </section>
        ) : null}

        <div className="mt-8 space-y-4">
          <StoreLocationCard page={page} />
          <BannerAds banners={page.banners} />
        </div>

        {(page.social.instagram || page.social.facebook || page.social.website) && (
          <nav className="mt-8 flex flex-wrap justify-center gap-4 text-sm font-medium">
            {page.social.website ? (
              <a href={page.social.website} target="_blank" rel="noopener noreferrer">
                Website
              </a>
            ) : null}
            {page.social.instagram ? (
              <a href={page.social.instagram} target="_blank" rel="noopener noreferrer">
                Instagram
              </a>
            ) : null}
            {page.social.facebook ? (
              <a href={page.social.facebook} target="_blank" rel="noopener noreferrer">
                Facebook
              </a>
            ) : null}
          </nav>
        )}

        <p className="mt-auto pt-12 text-center text-xs opacity-50">Powered by PostBus</p>
      </div>
    </div>
  );
}
