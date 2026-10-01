"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DeliveryEta } from "@/components/tracking-page/delivery-eta";
import { DeliveryProgress } from "@/components/tracking-page/delivery-progress";
import { ExceptionAlert } from "@/components/tracking-page/exception-alert";
import { OriginDestination } from "@/components/tracking-page/origin-destination";
import { ShipmentDetailsCard } from "@/components/tracking-page/shipment-details-card";
import { ShipmentJourney } from "@/components/tracking-page/shipment-journey";
import { ShipmentSummaryCard } from "@/components/tracking-page/shipment-summary-card";
import { TrackErrorState, TrackEmptyState, TrackSkeletons } from "@/components/tracking-page/track-skeletons";
import { TrackHeader } from "@/components/tracking-page/track-header";
import { TrackSearch } from "@/components/tracking-page/track-search";
import { TrackSupport } from "@/components/tracking-page/track-support";
import { api } from "@/lib/hooks/use-api";
import { toCustomerTrackView, type CustomerTrackView } from "@/modules/tracking-pages/customer-track-view";
import type { PublicTrackResult } from "@/types/api";

type ErrorKind = "not_found" | "unavailable";

function trackingUrl(article: string) {
  const url = new URL("/track", window.location.origin);
  url.searchParams.set("tracking", article);
  return url;
}

export function PostbusTrackPage({ initialQuery = "" }: { initialQuery?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorKind | null>(null);
  const [view, setView] = useState<CustomerTrackView | null>(null);

  async function lookup(value: string) {
    const article = value.trim();
    if (article.length < 6) return;
    setLoading(true);
    setError(null);
    setView(null);
    try {
      const data = await api<PublicTrackResult>("/api/v1/public/track", {
        method: "POST",
        body: JSON.stringify({ query: article }),
      });
      const next = toCustomerTrackView(data);
      if (!next) {
        setError("not_found");
        return;
      }
      setView(next);
      const nextUrl = trackingUrl(article);
      window.history.replaceState(null, "", `${nextUrl.pathname}${nextUrl.search}`);
    } catch {
      setError("unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const id = initialQuery.trim();
    if (id.length < 6) return;
    void lookup(id);
    // Deep links from notifications should look up once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  function onTrackAnother() {
    setView(null);
    setError(null);
    setQuery("");
    window.history.replaceState(null, "", "/track");
    inputRef.current?.focus();
  }

  async function onShare() {
    const article = view?.articleNumber || query.trim();
    const url = article.length >= 6 ? trackingUrl(article).toString() : `${window.location.origin}/track`;
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

  return (
    <div className="min-h-full bg-surface">
      <TrackHeader onTrackAnother={onTrackAnother} />
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
        <TrackSearch
          query={query}
          onQueryChange={setQuery}
          onSubmit={async (event) => {
            event.preventDefault();
            await lookup(query);
          }}
          loading={loading}
          inputRef={inputRef}
        />

        {loading ? <TrackSkeletons /> : null}

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
            <TrackSupport onTrackAnother={onTrackAnother} onShare={onShare} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
