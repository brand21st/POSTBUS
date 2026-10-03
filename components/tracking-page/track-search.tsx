import type { FormEvent, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TrackSearch({
  query,
  onQueryChange,
  onSubmit,
  loading,
  disabled = false,
  inputRef,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  loading: boolean;
  disabled?: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem]">Track Your Shipment</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        Enter your India Post tracking number to see the latest shipment updates.
      </p>
      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="tracking-number" className="sr-only">
            India Post article or barcode number
          </Label>
          <Input
            ref={inputRef}
            id="tracking-number"
            name="tracking"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Enter Article / Barcode Number"
            autoComplete="off"
            inputMode="text"
            minLength={6}
            required
            disabled={disabled}
            aria-describedby="tracking-helper"
            className="h-12 bg-white text-base sm:text-sm"
          />
        </div>
        <Button type="submit" size="lg" className="h-12 min-h-12 sm:w-auto" disabled={loading || disabled}>
          {loading ? "Tracking…" : "Track Shipment"}
        </Button>
      </form>
      <p id="tracking-helper" className="mt-2.5 text-xs text-muted">
        Track using your India Post article number or barcode. Example: EM123456789IN
      </p>
    </section>
  );
}
