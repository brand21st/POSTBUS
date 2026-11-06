"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { PincodeLocationHint } from "@/components/address/pincode-location-hint";
import { api } from "@/lib/hooks/use-api";
import type { IndiaPostDirectoryLookup } from "@/lib/india-post/pincode-directory";
import { listedIndianState } from "@/lib/indian-states";

export function useIndiaPostPincodeLookup(rawPincode: string) {
  const pincode = String(rawPincode ?? "").replace(/\D/g, "").slice(0, 6);
  const ready = /^[1-9][0-9]{5}$/.test(pincode);
  const lookup = useQuery({
    queryKey: ["india-post", "directory", pincode],
    queryFn: () =>
      api<IndiaPostDirectoryLookup>(`/api/v1/auth/pincode?pincode=${encodeURIComponent(pincode)}`),
    enabled: ready,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
  const office = lookup.data?.offices?.[0];
  return {
    ready,
    pincode,
    lookup,
    office,
    city: office?.city.trim() ?? "",
    state: listedIndianState(office?.state ?? ""),
  };
}

export function IndiaPostPincodeAutofill({
  pincode,
  fillKey,
  onFill,
}: {
  pincode: string;
  fillKey?: string;
  onFill: (next: { city: string; state: string }) => void;
}) {
  const { ready, pincode: digits, lookup, city, state } = useIndiaPostPincodeLookup(pincode);
  const filledFor = useRef("");

  useEffect(() => {
    filledFor.current = "";
  }, [fillKey]);

  useEffect(() => {
    if (!ready || (!city && !state)) return;
    const token = `${fillKey ?? ""}:${digits}`;
    if (filledFor.current === token) return;
    filledFor.current = token;
    onFill({ city, state });
  }, [city, digits, fillKey, onFill, ready, state]);

  if (!ready) return null;

  return (
    <PincodeLocationHint
      loading={lookup.isPending}
      error={
        lookup.isError
          ? lookup.error instanceof Error
            ? lookup.error.message
            : "Could not look up this PIN code."
          : null
      }
      offices={lookup.data?.offices}
    />
  );
}
