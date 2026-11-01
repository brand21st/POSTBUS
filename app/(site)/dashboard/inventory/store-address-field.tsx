"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/hooks/use-api";

type Availability = { slug: string; available: boolean; reason: string | null };

export function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

/** Turns "My Shop!" into "my-shop" as the merchant types; the server re-validates. */
export function toStoreAddress(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, 48);
}

export function StoreAddressField<T>({
  workspace,
  storeUrl,
  canChange,
  onSaved,
}: {
  workspace: string;
  storeUrl: string;
  canChange: boolean;
  onSaved: (settings: T) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const value = draft ?? workspace;
  const slug = value.replace(/-+$/, "");
  const changed = slug !== workspace;
  const checkSlug = useDebounced(slug, 350);
  const availability = useQuery({
    queryKey: ["storefront-address", checkSlug],
    enabled: canChange && changed && checkSlug === slug && slug.length > 0,
    retry: false,
    staleTime: 10_000,
    queryFn: ({ signal }) => api<Availability>(`/api/v1/inventory/storefront/address?slug=${encodeURIComponent(checkSlug)}`, { signal }),
  });
  const save = useMutation({
    mutationFn: () => api<T>("/api/v1/inventory/storefront/address", { method: "PATCH", body: JSON.stringify({ slug }) }),
    onSuccess: (data) => {
      onSaved(data);
      setDraft(null);
      setConfirming(false);
      toast.success("Store address updated.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const prefix = storeUrl.endsWith(`/${workspace}`) ? storeUrl.slice(0, -workspace.length).replace(/^https?:\/\//, "") : "/store/";
  const checking = changed && (checkSlug !== slug || availability.isFetching);
  const ready = changed && !checking && availability.data?.slug === slug && availability.data.available;

  return (
    <div className="min-w-0">
      <Label htmlFor="store-address">Store address</Label>
      <div className="mt-1 flex h-11 min-w-0 items-center overflow-hidden rounded-md border border-border bg-card focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30">
        <span className="shrink-0 truncate pl-3 text-xs text-muted" title={prefix}>{prefix}</span>
        <input
          id="store-address"
          className="h-full min-w-0 flex-1 bg-transparent pr-3 text-xs disabled:opacity-60"
          // The wrapper shows the focus ring; the global unlayered :focus-visible outline would draw a second one.
          style={{ outline: "none" }}
          value={value}
          maxLength={48}
          autoComplete="off"
          spellCheck={false}
          disabled={!canChange || save.isPending}
          aria-describedby="store-address-hint"
          onChange={(event) => setDraft(toStoreAddress(event.target.value))}
        />
      </div>
      <div id="store-address-hint" className="mt-1 flex min-h-5 items-center justify-between gap-2 text-xs">
        {!canChange ? (
          <span className="text-muted">Only owners and admins can change the address.</span>
        ) : !changed ? (
          <span className="text-muted">Letters, numbers and hyphens.</span>
        ) : checking ? (
          <span className="flex items-center gap-1 text-muted"><Loader2 className="size-3 animate-spin" />Checking…</span>
        ) : availability.isError ? (
          <span className="text-red-600">{availability.error instanceof Error ? availability.error.message : "Could not check this address."}</span>
        ) : availability.data?.available ? (
          <span className="flex items-center gap-1 text-emerald-600"><Check className="size-3" />Available</span>
        ) : (
          <span className="flex items-center gap-1 text-red-600"><X className="size-3" />{availability.data?.reason ?? "Not available."}</span>
        )}
        {changed && canChange ? (
          <span className="flex shrink-0 gap-1">
            <Button type="button" size="xs" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button type="button" size="xs" disabled={!ready || save.isPending} onClick={() => setConfirming(true)}>Change</Button>
          </span>
        ) : null}
      </div>

      <Dialog open={confirming} onOpenChange={(open) => !save.isPending && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change store address?</DialogTitle>
            <DialogDescription>
              Your store moves to <span className="font-medium text-ink">{prefix}{slug}</span>. The old link{" "}
              <span className="font-medium text-ink">{prefix}{workspace}</span> stops working right away.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-xl bg-surface-soft px-3 py-2 text-sm">
            Update the link anywhere you shared it: Instagram and WhatsApp bios, ads, and printed QR codes.
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => setConfirming(false)}>Cancel</Button>
            <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Changing…" : "Change address"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
