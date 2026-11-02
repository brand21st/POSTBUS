"use client";

import { useEffect, useMemo, useRef } from "react";
import { type Control, type FieldPath, type FieldValues, type UseFormSetValue, useWatch } from "react-hook-form";
import { cleanBookingAddressLines, SMART_ADDRESS_LABEL } from "@/modules/orders/clean-booking-address";

function text(value: unknown) {
  return String(value ?? "");
}

/**
 * Cleans address lines for booking and reports a live label for each field that changes.
 * Rewrites after the merchant leaves the field, or shortly after a paste into another control.
 */
export function useBookingAddressCleanup<T extends FieldValues>({
  control,
  setValue,
  line1Name,
  line2Name,
  line1Id,
  line2Id,
}: {
  control: Control<T>;
  setValue: UseFormSetValue<T>;
  line1Name: FieldPath<T>;
  line2Name: FieldPath<T>;
  line1Id: string;
  line2Id: string;
}) {
  const line1 = text(useWatch({ control, name: line1Name }));
  const line2 = text(useWatch({ control, name: line2Name }));
  const preview = useMemo(() => cleanBookingAddressLines({ line1, line2 }), [line1, line2]);
  const kept = useRef<{ line1: string; line2: string; changed1: boolean; changed2: boolean } | null>(null);
  const latest = useRef({ line1, line2, preview });
  latest.current = { line1, line2, preview };

  function apply() {
    const current = latest.current;
    const next = current.preview;
    if (!next) return;
    const changed1 = next.changed.line1;
    const changed2 = next.changed.line2;
    if (!changed1 && !changed2) return;
    if (changed1) setValue(line1Name, next.line1 as never, { shouldDirty: true, shouldValidate: true });
    if (changed2) setValue(line2Name, next.line2 as never, { shouldDirty: true, shouldValidate: true });
    kept.current = { line1: next.line1, line2: next.line2, changed1, changed2 };
  }

  useEffect(() => {
    if (!preview) return;
    const active = typeof document === "undefined" ? "" : document.activeElement?.id;
    if (active === line1Id || active === line2Id) return;
    const timer = window.setTimeout(apply, 0);
    return () => window.clearTimeout(timer);
  }, [line1, line2, line1Id, line2Id, preview]);

  const show1 =
    Boolean(preview?.changed.line1) ||
    Boolean(kept.current?.changed1 && line1.trim() === kept.current.line1.trim());
  const show2 =
    Boolean(preview?.changed.line2) ||
    Boolean(kept.current?.changed2 && line2.trim() === kept.current.line2.trim());

  return {
    notice: {
      line1: show1 ? SMART_ADDRESS_LABEL : null,
      line2: show2 ? SMART_ADDRESS_LABEL : null,
    },
    apply,
  };
}
