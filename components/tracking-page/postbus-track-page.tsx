"use client";

import { CustomerTrackExperience } from "@/components/tracking-page/customer-track-experience";

export function PostbusTrackPage({ initialQuery = "" }: { initialQuery?: string }) {
  return <CustomerTrackExperience global initialQuery={initialQuery} />;
}
