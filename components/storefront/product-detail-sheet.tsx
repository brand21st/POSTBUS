"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";
import { ProductCard } from "@/components/storefront/product-card";
import { StoreImage } from "@/components/storefront/store-image";
import type { CartLine, StoreProduct } from "@/components/storefront/store-types";
import { formatStorePrice } from "@/modules/storefront/pricing";
import { cn } from "@/lib/utils";

function ProductGallery({ product }: { product: StoreProduct }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  function goTo(next: number) {
    const target = Math.max(0, Math.min(product.imageUrls.length - 1, next));
    setIndex(target);
    const scroller = scrollerRef.current;
    scroller?.scrollTo({ left: target * scroller.clientWidth, behavior: "smooth" });
  }

  if (!product.imageUrls.length) {
    return (
      <div className="relative aspect-[5/4] overflow-hidden rounded-2xl bg-zinc-100 sm:aspect-square sm:rounded-3xl">
        <StoreImage src={null} alt="" sizes="100vw" />
      </div>
    );
  }

  return (
    <div>
      <div className="relative aspect-[5/4] overflow-hidden rounded-2xl bg-zinc-100 sm:aspect-square sm:rounded-3xl">
        <div
          ref={scrollerRef}
          className="absolute inset-0 flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ touchAction: "pan-x pinch-zoom" }}
          role="region"
          aria-roledescription="carousel"
          aria-label={`${product.name} photos`}
          onScroll={() => {
            const scroller = scrollerRef.current;
            if (!scroller?.clientWidth) return;
            setIndex(Math.round(scroller.scrollLeft / scroller.clientWidth));
          }}
        >
          {product.imageUrls.map((url, imageIndex) => (
            <div key={url} className="relative h-full w-full min-w-full shrink-0 snap-center snap-always">
              <StoreImage
                src={url}
                alt={imageIndex === 0 ? product.name : `${product.name} photo ${imageIndex + 1}`}
                sizes="(max-width: 640px) 100vw, 560px"
                preload={imageIndex === 0}
              />
            </div>
          ))}
        </div>
        {product.imageUrls.length > 1 ? (
          <>
            <button
              type="button"
              className="absolute left-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow ring-1 ring-zinc-200 disabled:opacity-30 sm:left-2 sm:size-11"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
              aria-label="Previous photo"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow ring-1 ring-zinc-200 disabled:opacity-30 sm:right-2 sm:size-11"
              onClick={() => goTo(index + 1)}
              disabled={index === product.imageUrls.length - 1}
              aria-label="Next photo"
            >
              <ChevronRight className="size-5" />
            </button>
          </>
        ) : null}
      </div>
      {product.imageUrls.length > 1 ? (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {product.imageUrls.map((url, imageIndex) => (
            <button
              key={url}
              type="button"
              className={cn(
                "relative size-16 shrink-0 overflow-hidden rounded-xl ring-2 transition",
                imageIndex === index ? "ring-zinc-900" : "ring-transparent opacity-65"
              )}
              onClick={() => goTo(imageIndex)}
              aria-label={`Show photo ${imageIndex + 1}`}
              aria-current={imageIndex === index ? true : undefined}
            >
              <StoreImage src={url} alt="" sizes="64px" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ProductDetailSheet({
  product,
  quantity,
  accent,
  related,
  cart,
  onClose,
  onAdd,
  onDecrease,
  onOpenProduct,
}: {
  product: StoreProduct;
  quantity: number;
  accent: string;
  related: StoreProduct[];
  cart: CartLine[];
  onClose: () => void;
  onAdd: (product: StoreProduct) => void;
  onDecrease: (productId: string) => void;
  onOpenProduct: (product: StoreProduct) => void;
}) {
  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={product.name}>
      <button className="absolute inset-0 cursor-default" type="button" onClick={onClose} aria-label="Close product" />
      <section className="absolute inset-x-0 bottom-0 flex max-h-[94dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-[1.75rem] bg-white shadow-2xl sm:inset-y-5 sm:left-1/2 sm:right-auto sm:w-[min(92vw,600px)] sm:-translate-x-1/2 sm:rounded-3xl">
        <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-zinc-200 sm:hidden" />
        <button
          type="button"
          className="absolute right-3 top-3 z-20 flex size-10 items-center justify-center rounded-full bg-white/95 shadow ring-1 ring-zinc-200 sm:right-4 sm:top-4 sm:size-11"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-5" />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-4 sm:p-4">
        <ProductGallery product={product} />
        <div className="py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 pr-10 text-xl font-bold tracking-tight">{product.name}</h2>
            {product.bestSeller ? <span className="rounded-full bg-zinc-950 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">Best seller</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-bold" style={{ color: accent }}>
              {formatStorePrice(product.price)}
            </span>
            {product.compareAtPrice ? (
              <span className="text-sm text-zinc-400 line-through">{formatStorePrice(product.compareAtPrice)}</span>
            ) : null}
            {product.discountPercent ? (
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                {product.discountPercent}% OFF
              </span>
            ) : null}
          </div>
          <p className={cn("mt-2 text-sm font-medium", product.inStock ? (product.lowStockThreshold != null && product.onHand <= product.lowStockThreshold ? "text-amber-700" : "text-emerald-700") : "text-zinc-500")}>
            {product.inStock
              ? product.lowStockThreshold != null && product.onHand <= product.lowStockThreshold
                ? `Only ${product.onHand} left`
                : `${product.onHand} in stock`
              : "Out of stock"}
          </p>
          {product.description ? <p className="mt-3 whitespace-pre-line text-sm leading-6 text-zinc-600">{product.description}</p> : null}
          {product.weightGrams ? <p className="mt-2 text-xs text-zinc-500">Weight: {product.weightGrams} g</p> : null}
          <div className="mt-4 rounded-2xl bg-zinc-50 p-3 text-xs text-zinc-600">
            <p className="font-semibold text-zinc-900">Payment options</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {product.prepaidEnabled ? <span>Prepaid accepted</span> : null}
              {product.codEnabled ? (
                <span>
                  {product.codAdvancePercent
                    ? `COD: ${formatStorePrice(Math.round(product.price * product.codAdvancePercent) / 100)} before dispatch`
                    : "Full cash on delivery"}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {related.length ? (
          <div className="border-t border-zinc-100 pt-4">
            <h3 className="mb-3 font-bold">You may also like</h3>
            <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {related.slice(0, 4).map((item) => (
                <ProductCard
                  key={item.id}
                  product={item}
                  quantity={cart.find((line) => line.product.id === item.id)?.quantity ?? 0}
                  accent={accent}
                  compact
                  onOpen={() => onOpenProduct(item)}
                  onAdd={() => onAdd(item)}
                  onDecrease={() => onDecrease(item.id)}
                />
              ))}
            </div>
          </div>
        ) : null}
        </div>
        <div className="flex shrink-0 gap-3 border-t border-zinc-100 bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4">
            {quantity > 0 ? (
              <div className="flex h-12 w-32 items-center justify-between rounded-2xl border border-zinc-200 px-1 sm:w-36">
                <button
                  type="button"
                  className="flex size-10 items-center justify-center rounded-xl active:scale-90"
                  onClick={() => onDecrease(product.id)}
                  aria-label="Decrease quantity"
                >
                  <Minus className="size-4" />
                </button>
                <span className="font-bold tabular-nums">{quantity}</span>
                <button
                  type="button"
                  className="flex size-10 items-center justify-center rounded-xl active:scale-90"
                  onClick={() => onAdd(product)}
                  aria-label="Increase quantity"
                >
                  <Plus className="size-4" />
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className="h-12 min-w-0 flex-1 rounded-2xl px-4 text-sm font-bold text-white shadow-sm transition active:scale-[0.98] disabled:bg-zinc-200 disabled:text-zinc-500"
              style={product.inStock ? { backgroundColor: accent } : undefined}
              disabled={!product.inStock}
              onClick={() => onAdd(product)}
            >
              {quantity ? "Add another" : product.inStock ? "Add to cart" : "Out of stock"}
            </button>
        </div>
      </section>
    </div>
  );
}
