"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { Search, ShoppingBag, X } from "lucide-react";
import { StoreImage } from "@/components/storefront/store-image";
import { storeHomePath } from "@/modules/storefront/footer";
import { formatStorePrice } from "@/modules/storefront/pricing";
import { formatOrderWindow, orderWindowRemaining, searchMatches, trendingProducts } from "@/modules/storefront/trending";
import type { StorePayload, StoreProduct } from "@/components/storefront/store-types";

export function StoreHeader({
  store,
  query = "",
  count = 0,
  showSearch = true,
  showCart = true,
  products = [],
  onQueryChange,
  onOpenCart,
  onOpenProduct,
}: {
  store: StorePayload;
  query?: string;
  count?: number;
  showSearch?: boolean;
  showCart?: boolean;
  products?: StoreProduct[];
  onQueryChange?: (value: string) => void;
  onOpenCart?: () => void;
  onOpenProduct?: (product: StoreProduct) => void;
}) {
  const home = storeHomePath(store.workspace);
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [phrase, setPhrase] = useState(0);
  const [windowLeft, setWindowLeft] = useState<number | null>(null);
  const trending = useMemo(() => trendingProducts(products, 5), [products]);
  const phrases = useMemo(() => ["Search products, categories...", ...trending.map((product) => `Try “${product.name}”`)], [trending]);
  const matches = useMemo(() => searchMatches(products, query, 5), [products, query]);
  const panelOpen = focused && (query.trim() ? matches.length > 0 : trending.length > 0);
  const suggestions = query.trim() ? matches : trending;

  useEffect(() => {
    if (query || focused || phrases.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setPhrase((current) => (current + 1) % phrases.length), 3600);
    return () => window.clearInterval(timer);
  }, [focused, phrases.length, query]);

  useEffect(() => {
    const tick = () => setWindowLeft(orderWindowRemaining());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-100 bg-white/95 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-2 px-3 py-2 sm:px-5 lg:flex-row lg:items-center lg:gap-4 lg:py-3">
        <div className="flex h-11 min-w-0 items-center gap-2 lg:h-12 lg:w-auto lg:max-w-sm lg:flex-none">
          <Link href={home} className="flex min-w-0 items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400">
            <span className="relative size-9 shrink-0 overflow-hidden rounded-full bg-zinc-100 ring-1 ring-zinc-200 lg:size-11">
              <StoreImage src={store.logoUrl} alt="" sizes="44px" preload />
            </span>
            <span className="min-w-0 flex-1 lg:flex-none lg:max-w-xs">
              <span className="block truncate text-[15px] font-bold text-zinc-950 lg:text-lg">{store.storeName}</span>
              <span className="block truncate text-[11px] text-zinc-500">WhatsApp store</span>
            </span>
          </Link>
          {showCart ? (
            <button
              type="button"
              className="relative ml-auto flex size-11 shrink-0 items-center justify-center rounded-full text-zinc-800 transition hover:bg-zinc-100 active:scale-95 lg:hidden"
              onClick={onOpenCart}
              aria-label={`Open cart, ${count} items`}
            >
              <ShoppingBag className="size-5" />
              {count ? (
                <span
                  className="absolute right-0.5 top-0.5 flex min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                  style={{ backgroundColor: store.accentColor }}
                >
                  {count > 99 ? "99+" : count}
                </span>
              ) : null}
            </button>
          ) : null}
        </div>
        {showSearch ? (
          <div className="relative w-full min-w-0 lg:max-w-xl lg:flex-1">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="search"
                value={query}
                role="combobox"
                aria-label="Search products"
                aria-expanded={panelOpen}
                aria-controls={listId}
                aria-autocomplete="list"
                onChange={(event) => onQueryChange?.(event.target.value)}
                onClick={() => setFocused(true)}
                onFocus={() => setFocused(true)}
                onBlur={() => window.setTimeout(() => setFocused(false), 160)}
                onKeyDown={(event) => { if (event.key === "Escape") setFocused(false); }}
                placeholder=""
                className="h-11 w-full rounded-2xl border border-zinc-200 bg-zinc-100/80 pl-10 pr-10 text-sm outline-none transition focus:border-zinc-300 focus:bg-white focus:ring-2 focus:ring-zinc-200"
              />
              {!query ? (
                <span className="pointer-events-none absolute left-10 right-10 top-1/2 h-5 -translate-y-1/2 overflow-hidden text-sm text-zinc-500" aria-hidden>
                  {phrases.map((text, index) => {
                    const active = index === phrase % phrases.length;
                    return (
                      <span
                        key={`${index}:${text}`}
                        className="absolute inset-x-0 top-0 truncate transition-opacity duration-700 ease-in-out motion-reduce:transition-none"
                        style={{ opacity: active ? 1 : 0 }}
                      >
                        {text}
                      </span>
                    );
                  })}
                </span>
              ) : null}
              {query ? (
                <button
                  type="button"
                  className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500"
                  onClick={() => onQueryChange?.("")}
                  aria-label="Clear search"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </label>
            {panelOpen ? (
              <div id={listId} role="listbox" aria-label={query.trim() ? "Matching products" : "Trending products"} className="absolute inset-x-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg">
                <p className="flex items-center justify-between gap-2 px-3 pt-2.5 text-[11px] font-semibold uppercase text-zinc-500">
                  <span>{query.trim() ? "Matching products" : "Trending now"}</span>
                  {windowLeft ? <span className="normal-case">Order in {formatOrderWindow(windowLeft)}</span> : null}
                </p>
                <ul className="p-1.5">
                  {suggestions.map((product) => (
                    <li key={product.id}>
                      <button
                        type="button"
                        role="option"
                        className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left hover:bg-zinc-50"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => { setFocused(false); onOpenProduct?.(product); }}
                      >
                        <span className="relative size-9 shrink-0 overflow-hidden rounded-lg bg-zinc-100">
                          <StoreImage src={product.imageUrls[0]} alt="" sizes="36px" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{product.name}</span>
                        <span className="shrink-0 text-xs font-bold">{formatStorePrice(product.price)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="hidden min-w-0 flex-1 lg:block" />
        )}
        {showCart ? (
          <button
            type="button"
            className="relative hidden size-11 shrink-0 items-center justify-center rounded-full text-zinc-800 transition hover:bg-zinc-100 active:scale-95 lg:flex"
            onClick={onOpenCart}
            aria-label={`Open cart, ${count} items`}
          >
            <ShoppingBag className="size-5" />
            {count ? (
              <span
                className="absolute right-0.5 top-0.5 flex min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                style={{ backgroundColor: store.accentColor }}
              >
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>
    </header>
  );
}
