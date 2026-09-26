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

const GROUPS = [
  { type: "order", label: "Orders" },
  { type: "shipment", label: "Shipments" },
  { type: "customer", label: "Customers" },
] as const;

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

function resultGroup(type?: string) {
  const value = (type ?? "").toLowerCase();
  if (value.includes("shipment") || value.includes("track")) return "shipment";
  if (value.includes("customer")) return "customer";
  return "order";
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
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebounced("");
      setActiveIndex(0);
    }
  }, [open]);

  const ready = debounced.length >= 2;
  const search = useQuery({
    queryKey: ["search", debounced],
    queryFn: ({ signal }) =>
      api<SearchResponse | SearchResult[]>(`/api/v1/search?${toSearchParams({ q: debounced })}`, {
        signal,
      }),
    enabled: open && ready,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const results = useMemo(
    () => (search.dataUpdatedAt && search.data ? flattenSearch(search.data) : []),
    [search.data, search.dataUpdatedAt]
  );
  const fetching = search.isFetching && ready;
  const grouped = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        items: results
          .map((result, index) => ({ result, index }))
          .filter(({ result }) => resultGroup(result.type) === group.type),
      })).filter((group) => group.items.length),
    [results]
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [debounced]);

  useEffect(() => {
    const node = listRef.current?.querySelector(`[data-search-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results.length]);

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
        className="top-[22vh] flex max-h-[min(36rem,calc(100vh-8rem))] w-[calc(100%-1.5rem)] max-w-xl translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="absolute m-[-1px] h-px w-px overflow-hidden border-0 p-0 whitespace-nowrap [clip:rect(0,0,0,0)]">
          Search
        </DialogTitle>
        <DialogDescription className="absolute m-[-1px] h-px w-px overflow-hidden border-0 p-0 whitespace-nowrap [clip:rect(0,0,0,0)]">
          Search orders, shipments, tracking numbers, and customers.
        </DialogDescription>

        <div className="flex items-center gap-3 border-b border-border px-4 pt-3">
          {fetching ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted" aria-hidden />
          ) : (
            <Search className="size-4 shrink-0 text-muted" aria-hidden />
          )}
          <input
            ref={inputRef}
            id="command-search-input"
            role="combobox"
            aria-expanded={ready}
            aria-controls="command-search-results"
            aria-activedescendant={results[activeIndex] ? `command-search-option-${activeIndex}` : undefined}
            aria-autocomplete="list"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search orders, AWB, tracking, customers…"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-ink shadow-none ring-0 placeholder:text-muted outline-none! focus:outline-none! focus-visible:outline-none!"
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

        <div
          ref={listRef}
          id="command-search-results"
          role="listbox"
          aria-label="Search results"
          className="min-h-[11rem] overflow-y-auto p-2"
        >
          {!ready ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm font-medium text-ink">Find an order, shipment, or customer</p>
              <p className="text-sm text-muted">Type at least two characters. Results update as you type.</p>
            </div>
          ) : search.isError ? (
            <p className="px-3 py-10 text-center text-sm text-error">
              {search.error instanceof Error ? search.error.message : "Search failed."}
            </p>
          ) : !results.length && fetching ? (
            <ul className="space-y-1" aria-hidden>
              {Array.from({ length: 5 }).map((_, index) => (
                <li key={index} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
                  <span className="size-8 shrink-0 animate-pulse rounded-lg bg-surface-soft" />
                  <span className="min-w-0 flex-1 space-y-2">
                    <span className="block h-3 w-32 animate-pulse rounded bg-surface-soft" />
                    <span className="block h-2.5 w-48 animate-pulse rounded bg-surface-soft" />
                  </span>
                </li>
              ))}
            </ul>
          ) : !results.length ? (
            <p className="px-3 py-10 text-center text-sm text-muted">No matches for “{debounced}”.</p>
          ) : (
            grouped.map((group) => (
              <div key={group.type} className="mb-1">
                <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                  {group.label}
                </p>
                {group.items.map(({ result, index }) => {
                  const active = index === activeIndex;
                  return (
                    <button
                      key={`${result.type ?? "item"}-${result.id}-${index}`}
                      id={`command-search-option-${index}`}
                      data-search-index={index}
                      type="button"
                      role="option"
                      aria-selected={active}
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
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted">
          <span>
            <kbd className="rounded border border-border bg-surface-soft px-1">↑</kbd>{" "}
            <kbd className="rounded border border-border bg-surface-soft px-1">↓</kbd> to move
          </span>
          <span>
            <kbd className="rounded border border-border bg-surface-soft px-1">Enter</kbd> to open
          </span>
          <span className="ml-auto">
            <kbd className="rounded border border-border bg-surface-soft px-1">Esc</kbd> to close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
