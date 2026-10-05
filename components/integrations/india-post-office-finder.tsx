"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";

export type IndiaPostOfficeRow = {
  officeId: string;
  name: string;
  pincode: string;
  city: string;
  state: string;
  officeTypeCode: string;
  taluk?: string;
  village?: string;
  deliveryOfficeFlag?: boolean;
  isRolledOut?: boolean;
};

type SearchResponse = {
  pincode: string;
  offices: IndiaPostOfficeRow[];
};

export function IndiaPostOfficeFinder({
  officeId,
  onSelect,
  onOfficeIdChange,
  canSearch,
  idPrefix = "office-finder",
  label = "Find by pincode",
}: {
  officeId: string;
  onSelect?: (office: IndiaPostOfficeRow) => void;
  onOfficeIdChange?: (officeId: string, officeName?: string) => void;
  canSearch: boolean;
  idPrefix?: string;
  label?: string;
}) {
  const [pincode, setPincode] = useState("");

  const search = useMutation({
    mutationFn: () => {
      const pin = pincode.replace(/\D/g, "").slice(0, 6);
      if (!/^\d{6}$/.test(pin)) {
        throw new Error("Enter a valid 6-digit pincode.");
      }
      return api<SearchResponse>(
        `/api/v1/integrations/india-post/offices?pincode=${encodeURIComponent(pin)}`
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const offices = search.data?.offices ?? [];
  const pinDigits = pincode.replace(/\D/g, "").slice(0, 6);
  const pinValid = /^\d{6}$/.test(pinDigits);
  const inputId = `${idPrefix}-pincode`;

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          inputMode="numeric"
          placeholder="682311"
          value={pincode}
          onChange={(event) => setPincode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canSearch && pinValid && !search.isPending) {
              event.preventDefault();
              search.mutate();
            }
          }}
        />
        {pincode ? (
          <Button
            type="button"
            variant="ghost"
            className="shrink-0 px-3"
            onClick={() => {
              setPincode("");
              search.reset();
            }}
          >
            Clear
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          className="shrink-0"
          disabled={!canSearch || !pinValid || search.isPending}
          onClick={() => search.mutate()}
        >
          <Search className="size-4" />
          {search.isPending ? "Searching" : "Find"}
        </Button>
      </div>
      <p className="text-xs text-muted">
        {canSearch
          ? pinDigits && !pinValid
            ? "Enter a valid 6-digit pincode."
            : search.isPending
              ? "Searching India Post offices..."
              : "Search India Post offices by the 6-digit pincode."
          : "Save your customer ID and password first, then search."}
      </p>

      {offices.length > 0 ? (
        <ul className="max-h-48 overflow-y-auto rounded-xl border border-border text-sm">
          {offices.map((office) => {
            const selected = office.officeId === officeId.trim();
            return (
              <li key={office.officeId} className="border-b border-border last:border-0">
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-soft",
                    selected && "bg-brand/5"
                  )}
                  onClick={() => {
                    onSelect?.(office);
                    onOfficeIdChange?.(office.officeId, office.name);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">
                      {office.name || "Post office"}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {[office.city, office.state, office.pincode, office.officeTypeCode]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {selected ? "Selected" : office.officeId}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : search.isSuccess ? (
        <p className="text-xs text-muted">No eligible India Post offices found for this pincode.</p>
      ) : null}
    </div>
  );
}
