"use client";

import { useEffect, useState } from "react";
import { siteConfig } from "@/lib/site-config";

type Phase = "connecting" | "unavailable";

export function PublicTrackingGate({
  subdomain,
  hostname,
}: {
  subdomain: string;
  hostname: string;
}) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [host, setHost] = useState(
    hostname.split(":")[0]?.toLowerCase() || `${subdomain}.postbus.in`
  );

  useEffect(() => {
    const liveHost = window.location.host.split(":")[0]?.toLowerCase();
    if (liveHost) setHost(liveHost);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timer = 0;

    async function tick() {
      attempts += 1;
      try {
        const response = await fetch(
          `/api/v1/public/tracking-page?subdomain=${encodeURIComponent(subdomain)}`,
          { cache: "no-store" }
        );
        const payload = (await response.json().catch(() => null)) as {
          success?: boolean;
          data?: unknown;
        } | null;
        if (cancelled) return;
        if (payload?.success && payload.data) {
          window.location.reload();
          return;
        }
      } catch {
        // Traefik or the origin may still be wiring this host.
      }
      if (cancelled) return;
      if (attempts >= 20) {
        setPhase("unavailable");
        return;
      }
      timer = window.setTimeout(tick, 3000);
    }

    timer = window.setTimeout(tick, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [subdomain]);

  const connecting = phase === "connecting";

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#fff7f8] px-6 py-10 text-ink">
      <div className="pointer-events-none absolute -left-24 top-10 size-72 rounded-full bg-brand/15 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 bottom-0 size-80 rounded-full bg-rose-200/50 blur-3xl" />

      <div className="relative mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center text-center">
        <div className="relative mb-10 flex size-36 items-center justify-center">
          <span className="tracking-connect-ring absolute inset-0 rounded-full border border-brand/25" />
          <span className="tracking-connect-ring tracking-connect-ring-delay absolute inset-3 rounded-full border border-brand/20" />
          <span className="absolute inset-6 rounded-full bg-white shadow-[0_12px_40px_rgb(225_29_72_/_0.18)]" />
          <span className="relative flex size-16 items-center justify-center rounded-2xl bg-brand text-lg font-bold tracking-tight text-white shadow-lg">
            PB
          </span>
        </div>

        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand">PostBus</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[2rem]">
          {connecting ? "Connecting this tracking page" : "This tracking page isn’t live yet"}
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          {connecting
            ? "We’re opening the public address for customers. This usually takes about a minute."
            : "The store hasn’t published a tracking page here, or this address is still being connected."}
        </p>

        <p className="mt-5 rounded-full border border-brand/15 bg-white px-4 py-1.5 font-mono text-sm text-ink shadow-sm">
          {host}
        </p>

        {connecting ? (
          <p className="mt-8 flex items-center gap-1 text-sm font-medium text-brand" aria-live="polite">
            Loading
            <span className="tracking-connect-dot">.</span>
            <span className="tracking-connect-dot tracking-connect-dot-2">.</span>
            <span className="tracking-connect-dot tracking-connect-dot-3">.</span>
          </p>
        ) : (
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              className="inline-flex h-11 items-center rounded-[var(--radius-btn)] bg-brand px-5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
            <a
              href={`${siteConfig.url}/track`}
              className="inline-flex h-11 items-center rounded-[var(--radius-btn)] border border-border bg-white px-5 text-sm font-semibold text-ink hover:bg-surface-soft"
            >
              Track on PostBus
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
