"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Package, Search, Truck, User, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, toSearchParams } from "@/lib/hooks/use-api";
import { flattenSearch } from "@/lib/dashboard/records";
import { titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SearchResponse, SearchResult } from "@/types/api";

function resultHref(result: SearchResult) {
  if (result.href) return result.href;
  const type = (result.type ?? "").toLowerCase();
  if (type.includes("order")) return `/dashboard/orders/${result.id}`;
  if (type.includes("shipment")) return `/dashboard/shipments/${result.id}`;
  if (type.includes("track")) return `/dashboard/tracking?q=${encodeURIComponent(result.title ?? result.id)}`;
  return `/dashboard/orders/${result.id}`;
}

function ResultIcon({ type }: { type?: string }) {
  const value = (type ?? "").toLowerCase();
  if (value.includes("shipment") || value.includes("track")) return <Truck className="size-4" />;
  if (value.includes("customer")) return <User className="size-4" />;
  return <Package className="size-4" />;
}

export function CommandSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebounced("");
      setActiveIndex(0);
    }
  }, [open]);

  const search = useQuery({
    queryKey: ["search", debounced],
    queryFn: () =>
      api<SearchResponse | SearchResult[]>(`/api/v1/search?${toSearchParams({ q: debounced })}`),
    enabled: open && debounced.length >= 2,
    placeholderData: (previous) => previous,
  });

  const results = useMemo(() => flattenSearch(search.data), [search.data]);
  const ready = debounced.length >= 2;
  const fetching = search.isFetching && ready;

  useEffect(() => {
    setActiveIndex(0);
  }, [debounced, results.length]);

  function go(result: SearchResult) {
    onOpenChange(false);
    router.push(resultHref(result));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!results.length) return;
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!results.length) return;
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = results[activeIndex];
      if (selected) go(selected);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        className="flex max-h-[min(32rem,calc(100vh-4rem))] w-[calc(100%-1.5rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search orders, shipments, tracking numbers, and customers.
        </DialogDescription>

        <div className="flex items-center gap-3 border-b border-border px-4">
          {fetching ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted" />
          ) : (
            <Search className="size-4 shrink-0 text-muted" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search orders, AWB, tracking, customers…"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setDebounced("");
                inputRef.current?.focus();
              }}
              className="rounded-md p-1 text-muted hover:bg-surface-soft hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
          <kbd className="hidden shrink-0 rounded-md border border-border bg-surface-soft px-1.5 py-0.5 text-[10px] font-medium text-muted sm:inline-block">
            Esc
          </kbd>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!ready ? (
            <p className="px-3 py-8 text-center text-sm text-muted">
              Type at least two characters to search orders, shipments, and customers.
            </p>
          ) : search.isError ? (
            <p className="px-3 py-8 text-center text-sm text-error">
              {search.error instanceof Error ? search.error.message : "Search failed."}
            </p>
          ) : !results.length && fetching ? (
            <p className="px-3 py-8 text-center text-sm text-muted">Searching…</p>
          ) : !results.length ? (
            <p className="px-3 py-8 text-center text-sm text-muted">No matches for “{debounced}”.</p>
          ) : (
            <ul className="space-y-0.5" role="listbox">
              {results.map((result, index) => {
                const active = index === activeIndex;
                return (
                  <li key={`${result.type ?? "item"}-${result.id}-${index}`} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => go(result)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left",
                        active ? "bg-surface-soft" : "hover:bg-surface-soft/70"
                      )}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted">
                        <ResultIcon type={result.type} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {result.title ?? result.id}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {[result.type ? titleCase(result.type) : null, result.subtitle]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
