"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { PincodeLocationHint } from "@/components/address/pincode-location-hint";
import { api } from "@/lib/hooks/use-api";
import type { RegisterAccountInput, RegisterAccountValues } from "@/lib/auth/register-schema";
import type { IndiaPostDirectoryLookup } from "@/lib/india-post/pincode-directory";

export function RegisterPincodeLookup({
  form,
}: {
  form: UseFormReturn<RegisterAccountInput, unknown, RegisterAccountValues>;
}) {
  const value = useWatch({ control: form.control, name: "pincode" });
  const pincode = String(value ?? "").replace(/\D/g, "");
  const ready = /^[1-9][0-9]{5}$/.test(pincode);
  const filledFor = useRef("");
  const lookup = useQuery({
    queryKey: ["register-pincode", pincode],
    queryFn: () =>
      api<IndiaPostDirectoryLookup>(`/api/v1/auth/pincode?pincode=${encodeURIComponent(pincode)}`),
    enabled: ready,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });

  const city = lookup.data?.offices?.[0]?.city.trim() ?? "";

  useEffect(() => {
    if (!ready) {
      if (filledFor.current) {
        filledFor.current = "";
        form.setValue("city", "", { shouldDirty: true, shouldValidate: false });
        form.clearErrors("city");
      }
      return;
    }
    if (!city || filledFor.current === pincode) return;
    filledFor.current = pincode;
    form.setValue("city", city, { shouldDirty: true, shouldValidate: true, shouldTouch: false });
    form.clearErrors("city");
  }, [city, form, pincode, ready]);

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
