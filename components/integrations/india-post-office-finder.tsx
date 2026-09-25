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
import type { ProviderEnvironment } from "@/types/domain";

type OfficeRow = {
  officeId: string;
  name: string;
  pincode: string;
  city: string;
  state: string;
  officeTypeCode: string;
};

type SearchResponse = {
  pincode: string;
  offices: OfficeRow[];
};

export function IndiaPostOfficeFinder({
  environment,
  officeId,
  onOfficeIdChange,
  canSearch,
}: {
  environment: ProviderEnvironment;
  officeId: string;
  onOfficeIdChange: (officeId: string) => void;
  canSearch: boolean;
}) {
  const [pincode, setPincode] = useState("");

  const search = useMutation({
    mutationFn: () => {
      const pin = pincode.replace(/\D/g, "").slice(0, 6);
      return api<SearchResponse>(
        `/api/v1/integrations/india-post/offices?pincode=${encodeURIComponent(pin)}`
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const offices = search.data?.offices ?? [];
  const pinValid = /^\d{6}$/.test(pincode.replace(/\D/g, "").slice(0, 6));

  return (
    <div className="space-y-3 md:col-span-2">
      <div className="space-y-2">
        <Label htmlFor="office-finder-pincode">Find office by pincode</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="office-finder-pincode"
            inputMode="numeric"
            placeholder="6-digit booking office pincode"
            value={pincode}
            onChange={(event) => setPincode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            className="max-w-[12rem]"
          />
          <Button
            type="button"
            variant="secondary"
            disabled={!canSearch || !pinValid || search.isPending}
            onClick={() => search.mutate()}
          >
            <Search className="size-4" />
            {search.isPending ? "Searching…" : "Find offices"}
          </Button>
        </div>
        {!canSearch ? (
          <p className="text-xs text-muted">Save customer ID and password, then use Save & connect before searching.</p>
        ) : (
          <p className="text-xs text-muted">
            Uses the CEPT <code className="text-foreground">pincode-search</code> API for{" "}
            {environment === "PRODUCTION" ? "production" : "UAT"}.
          </p>
        )}
      </div>

      {offices.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border text-sm">
          {offices.map((office) => {
            const selected = office.officeId === officeId.trim();
            return (
              <li key={office.officeId}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-surface-soft",
                    selected && "bg-brand/5"
                  )}
                  onClick={() => {
                    onOfficeIdChange(office.officeId);
                    toast.success(`Office ID ${office.officeId} selected.`);
                  }}
                >
                  <span className="font-medium text-foreground">
                    {office.name || "Post office"}{" "}
                    <span className="font-mono text-xs text-muted">({office.officeId})</span>
                  </span>
                  <span className="text-xs text-muted">
                    {[office.city, office.state, office.pincode].filter(Boolean).join(" · ")}
                    {office.officeTypeCode ? ` · ${office.officeTypeCode}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : search.isSuccess ? (
        <p className="text-sm text-muted">No post offices returned for this pincode.</p>
      ) : null}
    </div>
  );
}
