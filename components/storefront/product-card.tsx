"use client";

import { Flame, Minus, Plus, ShoppingCart } from "lucide-react";
import { StoreImage } from "@/components/storefront/store-image";
import type { StoreProduct } from "@/components/storefront/store-types";
import { formatStorePrice } from "@/modules/storefront/pricing";
import { cn } from "@/lib/utils";

const NEW_PRODUCT_CUTOFF = Date.now() - 30 * 86_400_000;

export function ProductCard({
  product,
  quantity,
  accent,
  compact = false,
  onOpen,
  onAdd,
  onDecrease,
}: {
  product: StoreProduct;
  quantity: number;
  accent: string;
  compact?: boolean;
  onOpen: () => void;
  onAdd: () => void;
  onDecrease: () => void;
}) {
  const lowStock =
    product.inStock &&
    product.lowStockThreshold != null &&
    product.onHand <= product.lowStockThreshold;
  const isNew =
    Boolean(product.createdAt) &&
    new Date(product.createdAt!).getTime() >= NEW_PRODUCT_CUTOFF;
  return (
    <article
      className={cn(
        "group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-[0_8px_24px_rgba(24,24,27,0.06)] ring-1 ring-zinc-100",
        compact && "w-[min(42vw,9.5rem)] shrink-0 sm:w-48 sm:max-w-none"
      )}
    >
      <button type="button" className="flex min-w-0 flex-1 flex-col text-left" onClick={onOpen}>
        <div className="relative aspect-[5/4] overflow-hidden bg-zinc-100">
          <StoreImage
            src={product.imageUrls[0]}
            alt={product.name}
            sizes={compact ? "176px" : "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 260px"}
            className="transition-transform duration-300 group-hover:scale-[1.03]"
          />
          {product.discountPercent ? (
            <span
              className="absolute bottom-1.5 left-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm sm:bottom-2 sm:left-2 sm:px-2 sm:py-1"
              style={{ backgroundColor: accent }}
            >
              {product.discountPercent}% OFF
            </span>
          ) : null}
          <div className="absolute left-1.5 top-1.5 flex max-w-[calc(100%-0.75rem)] flex-wrap gap-1 sm:left-2 sm:top-2">
            {product.bestSeller ? (
              <span className="inline-flex max-w-full items-center truncate rounded-full bg-zinc-950 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow sm:px-2 sm:py-1">
                <Flame className="mr-0.5 size-2.5 shrink-0 sm:mr-1 sm:size-3" />
                Best seller
              </span>
            ) : null}
            {isNew ? (
              <span className="rounded-full bg-white/95 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-zinc-800 shadow sm:px-2 sm:py-1">
                New
              </span>
            ) : null}
          </div>
          {!product.inStock ? (
            <span className="absolute inset-0 flex items-center justify-center bg-white/65 text-[11px] font-semibold text-zinc-700 backdrop-blur-[1px] sm:text-xs">
              Out of stock
            </span>
          ) : null}
        </div>
        <div className={cn("min-w-0 flex-1 px-2 pt-2 sm:px-3 sm:pt-2.5", compact && "px-2 pt-2")}>
          <h3 className="line-clamp-2 min-h-9 text-[13px] font-semibold leading-tight text-zinc-900 sm:min-h-10 sm:text-sm sm:leading-5">
            {product.name}
          </h3>
          <div className="mt-1 flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 text-[13px] font-bold tabular-nums text-zinc-950 sm:text-sm">
              {formatStorePrice(product.price)}
            </span>
            {product.compareAtPrice ? (
              <span className="min-w-0 truncate text-[11px] text-zinc-400 line-through sm:text-xs">
                {formatStorePrice(product.compareAtPrice)}
              </span>
            ) : null}
          </div>
          {lowStock ? (
            <p className="mt-1 min-h-[15px] text-[11px] font-semibold text-amber-700">Only {product.onHand} left</p>
          ) : (
            <span className="mt-1 block min-h-[15px]" aria-hidden />
          )}
        </div>
      </button>
      <div className="mt-auto p-2 pt-1 sm:p-3 sm:pt-2">
        {quantity > 0 ? (
          <div
            className="flex h-9 items-center justify-between rounded-xl border px-0.5 text-white shadow-sm sm:h-10 sm:px-1"
            style={{ backgroundColor: accent, borderColor: accent }}
          >
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-lg transition active:scale-90 sm:size-9"
              onClick={onDecrease}
              aria-label={`Decrease ${product.name}`}
            >
              <Minus className="size-4" />
            </button>
            <span className="min-w-5 text-center text-sm font-bold tabular-nums" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-lg transition active:scale-90 sm:size-9"
              onClick={onAdd}
              aria-label={`Increase ${product.name}`}
            >
              <Plus className="size-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold text-white shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 sm:h-10 sm:gap-2 sm:text-sm"
            style={product.inStock ? { backgroundColor: accent } : undefined}
            disabled={!product.inStock}
            onClick={onAdd}
          >
            <ShoppingCart className="size-3.5 sm:size-4" />
            {product.inStock ? "Add" : "Out of stock"}
          </button>
        )}
      </div>
    </article>
  );
}
