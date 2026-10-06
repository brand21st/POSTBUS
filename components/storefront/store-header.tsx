"use client";

import Link from "next/link";
import { Search, ShoppingBag, X } from "lucide-react";
import { StoreImage } from "@/components/storefront/store-image";
import { storeHomePath } from "@/modules/storefront/footer";
import type { StorePayload } from "@/components/storefront/store-types";

export function StoreHeader({
  store,
  query = "",
  count = 0,
  showSearch = true,
  showCart = true,
  onQueryChange,
  onOpenCart,
}: {
  store: StorePayload;
  query?: string;
  count?: number;
  showSearch?: boolean;
  showCart?: boolean;
  onQueryChange?: (value: string) => void;
  onOpenCart?: () => void;
}) {
  const home = storeHomePath(store.workspace);
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
          <label className="relative block w-full min-w-0 lg:max-w-xl lg:flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={query}
              onChange={(event) => onQueryChange?.(event.target.value)}
              placeholder="Search products, categories..."
              className="h-11 w-full rounded-2xl border border-zinc-200 bg-zinc-100/80 pl-10 pr-10 text-sm outline-none transition placeholder:text-zinc-500 focus:border-zinc-300 focus:bg-white focus:ring-2 focus:ring-zinc-200"
            />
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
