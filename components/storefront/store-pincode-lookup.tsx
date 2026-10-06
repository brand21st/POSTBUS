"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { PincodeLocationHint } from "@/components/address/pincode-location-hint";
import { api } from "@/lib/hooks/use-api";
import { INDIAN_STATES } from "@/lib/indian-states";
import type { PublicPincodeLookup } from "@/modules/customer-order-links/public";
import { publicOrderLinkApiPath } from "@/modules/customer-order-links/schema";

type StoreRef = { workspace?: string; publicId?: string; token?: string };

function listedState(value: string) {
  const normalized = value.trim().toLowerCase();
  return INDIAN_STATES.find((state) => state.toLowerCase() === normalized) ?? value.trim();
}

export function StorePincodeLookup({
  linkRef,
  pincode,
  onResolve,
}: {
  linkRef: StoreRef;
  pincode: string;
  onResolve: (city: string, state: string) => void;
}) {
  const digits = pincode.replace(/\D/g, "");
  const ready = /^\d{6}$/.test(digits);
  const resolvedRef = useRef("");
  const lookup = useQuery({
    queryKey: ["store-pincode", linkRef.workspace, linkRef.publicId, linkRef.token, digits],
    queryFn: () => {
      const base = publicOrderLinkApiPath(linkRef, "pincode");
      if (!base) throw new Error("This store link is not valid.");
      const join = base.includes("?") ? "&" : "?";
      return api<PublicPincodeLookup>(`${base}${join}pincode=${encodeURIComponent(digits)}`);
    },
    enabled: ready,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });

  const office = lookup.data?.offices?.[0];
  useEffect(() => {
    if (!office || resolvedRef.current === digits) return;
    resolvedRef.current = digits;
    onResolve(office.city?.trim() ?? "", listedState(office.state ?? ""));
  }, [digits, office, onResolve]);

  if (!ready) return null;

  return (
    <PincodeLocationHint
      loading={lookup.isPending}
      error={lookup.isError ? "Could not look up this PIN code." : null}
      offices={lookup.data?.offices}
    />
  );
}
