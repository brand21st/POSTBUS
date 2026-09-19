"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, toSearchParams } from "@/lib/hooks/use-api";
import { flattenSearch } from "@/lib/dashboard/records";
import { titleCase } from "@/lib/format";
import type { SearchResponse, SearchResult } from "@/types/api";

function resultHref(result: SearchResult) {
  if (result.href) return result.href;
  const type = (result.type ?? "").toLowerCase();
  if (type.includes("order")) return `/dashboard/orders/${result.id}`;
  if (type.includes("shipment")) return `/dashboard/shipments/${result.id}`;
  if (type.includes("track")) return `/dashboard/tracking?q=${encodeURIComponent(result.title ?? result.id)}`;
  return `/dashboard/orders/${result.id}`;
}

export function CommandSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const search = useQuery({
    queryKey: ["search", debounced],
    queryFn: () =>
      api<SearchResponse | SearchResult[]>(`/api/v1/search?${toSearchParams({ q: debounced })}`),
    enabled: open && debounced.length >= 2,
  });

  const results = useMemo(() => flattenSearch(search.data), [search.data]);

  function go(result: SearchResult) {
    onOpenChange(false);
    setQuery("");
    router.push(resultHref(result));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Search</DialogTitle>
          <DialogDescription>Search orders, shipments, tracking numbers, and customers.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="size-4 text-muted" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search orders, shipments, tracking…"
            className="h-12 border-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {debounced.length < 2 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">
              Type at least two characters to search.
            </p>
          ) : search.isLoading ? (
            <p className="px-3 py-8 text-center text-sm text-muted">Searching…</p>
          ) : search.isError ? (
            <p className="px-3 py-8 text-center text-sm text-error">
              {search.error instanceof Error ? search.error.message : "Search failed."}
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">No matches for “{debounced}”.</p>
          ) : (
            <ul className="space-y-1">
              {results.map((result) => (
                <li key={`${result.type ?? "item"}-${result.id}`}>
                  <button
                    type="button"
                    onClick={() => go(result)}
                    className="flex w-full flex-col rounded-xl px-3 py-2.5 text-left hover:bg-surface-soft"
                  >
                    <span className="text-sm font-medium text-ink">
                      {result.title ?? result.id}
                    </span>
                    <span className="text-xs text-muted">
                      {[result.type ? titleCase(result.type) : null, result.subtitle]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
