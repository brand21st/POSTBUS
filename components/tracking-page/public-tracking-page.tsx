"use client";

import { CustomerTrackExperience } from "@/components/tracking-page/customer-track-experience";
import { PublicTrackingGate } from "@/components/tracking-page/public-tracking-gate";
import type { TrackingPageRecord } from "@/types/api";

export function PublicTrackingPage({
  page,
  unavailable = false,
  preview = false,
  lookupEnabled = true,
  compact = false,
  global = false,
  initialQuery = "",
}: {
  page?: TrackingPageRecord | null;
  unavailable?: boolean;
  preview?: boolean;
  lookupEnabled?: boolean;
  compact?: boolean;
  global?: boolean;
  initialQuery?: string;
}) {
  if (unavailable || !page) {
    return (
      <PublicTrackingGate
        subdomain={page?.subdomain ?? ""}
        hostname={typeof window === "undefined" ? "" : window.location.host}
      />
    );
  }

  return (
    <CustomerTrackExperience
      page={page}
      preview={preview}
      lookupEnabled={lookupEnabled}
      compact={compact}
      global={global}
      initialQuery={initialQuery}
    />
  );
}
