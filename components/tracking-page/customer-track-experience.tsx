"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BannerAds } from "@/components/tracking-page/banner-ads";
import { DeliveryEta } from "@/components/tracking-page/delivery-eta";
import { DeliveryProgress } from "@/components/tracking-page/delivery-progress";
import { ExceptionAlert } from "@/components/tracking-page/exception-alert";
import { OriginDestination } from "@/components/tracking-page/origin-destination";
import { ShipmentDetailsCard } from "@/components/tracking-page/shipment-details-card";
import { ShipmentJourney } from "@/components/tracking-page/shipment-journey";
import { ShipmentSummaryCard } from "@/components/tracking-page/shipment-summary-card";
import { StoreLocationCard } from "@/components/tracking-page/store-location-card";
import { TrackErrorState, TrackEmptyState, TrackSkeletons } from "@/components/tracking-page/track-skeletons";
import { TrackHeader, type TrackBrand } from "@/components/tracking-page/track-header";
import { TrackSearch } from "@/components/tracking-page/track-search";
import { TrackSupport } from "@/components/tracking-page/track-support";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";
import { merchantSupportHref } from "@/modules/tracking-pages/customer-support";
import { toCustomerTrackView, type CustomerTrackView } from "@/modules/tracking-pages/customer-track-view";
import type { PublicTrackResult, TrackingPageRecord } from "@/types/api";

type ErrorKind = "not_found" | "unavailable" | "preview";

function trackingShareUrl(article: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("tracking", article);
  return url;
}

export function CustomerTrackExperience({
  page,
  initialQuery = "",
  preview = false,
  lookupEnabled = true,
  compact = false,
  global = false,
}: {
  page?: TrackingPageRecord | null;
  initialQuery?: string;
  preview?: boolean;
  lookupEnabled?: boolean;
  compact?: boolean;
  global?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorKind | null>(null);
  const [view, setView] = useState<CustomerTrackView | null>(null);

  const merchant = Boolean(page && !global);
  const accent = page?.primaryColor || "#E11D48";
  const background = page?.backgroundColor || (merchant ? "#FFFFFF" : undefined);
  const brand: TrackBrand = merchant
    ? {
        kind: "merchant",
        storeName: page!.storeName,
        logoUrl: page!.logoUrl ?? null,
        accent,
      }
    : { kind: "postbus" };
  const helpHref = merchant ? merchantSupportHref(page!) : "/contact";

  async function lookup(value: string) {
    const article = value.trim();
    if (article.length < 6) return;
    if (!lookupEnabled || preview) {
      setError(preview ? "preview" : null);
      return;
    }
    setLoading(true);
    setError(null);
    setView(null);
    try {
      const body: { query: string; subdomain?: string } = { query: article };
      if (merchant && page?.subdomain) body.subdomain = page.subdomain;
      const data = await api<PublicTrackResult>("/api/v1/public/track", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const next = toCustomerTrackView(data);
      if (!next) {
        setError("not_found");
        return;
      }
      setView(next);
      if (!compact) {
        const nextUrl = trackingShareUrl(article);
        window.history.replaceState(null, "", `${nextUrl.pathname}${nextUrl.search}`);
      }
    } catch {
      setError("unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const id = initialQuery.trim();
    if (id.length < 6 || !lookupEnabled || preview) return;
    if (merchant && !page?.subdomain) return;
    void lookup(id);
    // Deep links from notifications should look up once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, lookupEnabled, preview, page?.subdomain, merchant]);

  function onTrackAnother() {
    setView(null);
    setError(null);
    setQuery("");
    if (!compact) {
      const url = new URL(window.location.href);
      url.searchParams.delete("tracking");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
    inputRef.current?.focus();
  }

  async function onShare() {
    const article = view?.articleNumber || query.trim();
    const url =
      article.length >= 6 ? trackingShareUrl(article).toString() : window.location.origin + window.location.pathname;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Tracking link copied");
    } catch {
      toast.error("Unable to copy the tracking link");
    }
  }

  const pulse = Boolean(
    view && view.statusKey !== "DELIVERED" && view.statusTone !== "error" && view.statusTone !== "warning"
  );

  const themeStyle = {
    backgroundColor: background,
    "--brand": accent,
    "--brand-dark": accent,
  } as CSSProperties;

  return (
    <div className={cn(compact ? "min-h-0 bg-surface" : "min-h-full bg-surface")} style={themeStyle}>
      <TrackHeader
        brand={brand}
        helpHref={helpHref}
        compact={compact}
        onTrackAnother={onTrackAnother}
      />
      <div
        className={cn(
          "mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6",
          compact ? "py-4" : "sm:py-8"
        )}
      >
        {merchant && (page?.tagline || page?.about) ? (
          <p className="text-sm text-muted">{page?.about || page?.tagline}</p>
        ) : null}

        <TrackSearch
          query={query}
          onQueryChange={setQuery}
          onSubmit={async (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            await lookup(query);
          }}
          loading={loading}
          disabled={!lookupEnabled}
          inputRef={inputRef}
        />

        {loading ? <TrackSkeletons /> : null}

        {!loading && error === "preview" ? (
          <TrackErrorState
            title="Live lookup is available after publish"
            description="Publish this tracking page to look up shipments for your customers."
          />
        ) : null}

        {!loading && error === "not_found" ? (
          <TrackErrorState
            title="Tracking number not found"
            description="Please check the article number and try again."
          />
        ) : null}

        {!loading && error === "unavailable" ? (
          <TrackErrorState
            title="Unable to load tracking information"
            description="Please try again in a moment."
          />
        ) : null}

        {!loading && !error && !view ? <TrackEmptyState /> : null}

        {!loading && view ? (
          <div className="space-y-4" aria-live="polite">
            {view.exception ? <ExceptionAlert exception={view.exception} /> : null}
            <ShipmentSummaryCard view={view} />
            <DeliveryProgress steps={view.progress} pulse={pulse} />
            <OriginDestination origin={view.origin} destination={view.destination} />
            <ShipmentJourney events={view.events} />
            <ShipmentDetailsCard details={view.details} />
            <DeliveryEta expectedDeliveryAt={view.expectedDeliveryAt} />
            <TrackSupport helpHref={helpHref} onTrackAnother={onTrackAnother} onShare={onShare} />
          </div>
        ) : null}

        {merchant && page ? (
          <div className="space-y-4">
            <StoreLocationCard page={page} />
            <BannerAds banners={page.banners} />
            {(page.social.instagram || page.social.facebook || page.social.website) && (
              <nav className="flex flex-wrap justify-center gap-4 text-sm font-medium" aria-label="Store links">
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
            <p className="pt-2 text-center text-xs text-muted">Powered by PostBus</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
