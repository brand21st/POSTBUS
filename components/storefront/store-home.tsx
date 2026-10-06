"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProductCard } from "@/components/storefront/product-card";
import { StoreHeader } from "@/components/storefront/store-header";
import { StorefrontFooter } from "@/components/storefront/storefront-footer";
import { StoreImage } from "@/components/storefront/store-image";
import type {
  CartLine,
  StoreCategory,
  StorePayload,
  StoreProduct,
  StoreSlide,
} from "@/components/storefront/store-types";
import { cn } from "@/lib/utils";

function safeCtaHref(value?: string | null) {
  if (!value) return null;
  if (value.startsWith("/") || value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function HeroSlider({ slides }: { slides: StoreSlide[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  const pausedRef = useRef(false);
  const resumeTimer = useRef<number | null>(null);
  const [index, setIndex] = useState(0);

  function pause() {
    pausedRef.current = true;
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
  }

  function resumeSoon() {
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => {
      pausedRef.current = false;
    }, 2500);
  }

  const goTo = useCallback((next: number) => {
    if (!slides.length) return;
    const target = ((next % slides.length) + slides.length) % slides.length;
    indexRef.current = target;
    setIndex(target);
    const scroller = scrollerRef.current;
    scroller?.scrollTo({ left: target * scroller.clientWidth, behavior: "smooth" });
  }, [slides.length]);

  useEffect(() => {
    if (slides.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (!pausedRef.current && !document.hidden) goTo(indexRef.current + 1);
    }, 4500);
    return () => {
      window.clearInterval(timer);
      if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
    };
  }, [goTo, slides.length]);

  return (
    <section className="relative mt-3 overflow-hidden rounded-2xl bg-zinc-100 shadow-sm sm:rounded-3xl" aria-label="Store offers">
      <div className="relative aspect-[16/9] max-h-[128px] w-full sm:max-h-[200px] lg:aspect-[2.6/1] lg:max-h-[240px]">
      <div
        ref={scrollerRef}
        className="absolute inset-0 flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ touchAction: "pan-x pinch-zoom" }}
        onPointerDown={pause}
        onPointerUp={resumeSoon}
        onPointerCancel={resumeSoon}
        onMouseEnter={pause}
        onMouseLeave={resumeSoon}
        onScroll={() => {
          const scroller = scrollerRef.current;
          if (!scroller?.clientWidth) return;
          const next = Math.round(scroller.scrollLeft / scroller.clientWidth);
          if (next >= 0 && next < slides.length && next !== indexRef.current) {
            indexRef.current = next;
            setIndex(next);
          }
        }}
      >
        {slides.map((slide, slideIndex) => {
          const ctaHref = safeCtaHref(slide.ctaHref);
          return (
          <article key={slide.id} className="relative h-full w-full min-w-full shrink-0 snap-center snap-always">
            <StoreImage
              src={slide.imageUrl}
              alt={slide.title || `Offer ${slideIndex + 1}`}
              sizes="(max-width: 768px) 100vw, 1152px"
              preload={slideIndex === 0}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent sm:bg-gradient-to-r sm:from-black/60 sm:via-black/20 sm:to-transparent">
              <div className="absolute inset-x-4 bottom-7 max-w-[88%] text-white sm:inset-x-5 sm:bottom-8 sm:max-w-[60%]">
                {slide.title ? (
                  <h2 className="text-lg font-bold leading-tight drop-shadow sm:text-3xl">{slide.title}</h2>
                ) : null}
                {slide.subtitle ? (
                  <p className="mt-1 line-clamp-2 text-[11px] text-white/90 drop-shadow sm:text-sm">{slide.subtitle}</p>
                ) : null}
                {slide.ctaLabel && ctaHref ? (
                  <a
                    href={ctaHref}
                    className="mt-3 inline-flex min-h-10 items-center rounded-full bg-white px-4 py-2 text-xs font-bold text-zinc-900 shadow transition active:scale-95"
                  >
                    {slide.ctaLabel}
                  </a>
                ) : slide.ctaLabel ? (
                  <span className="mt-3 inline-flex min-h-10 items-center rounded-full bg-white px-4 py-2 text-xs font-bold text-zinc-900 shadow">
                    {slide.ctaLabel}
                  </span>
                ) : null}
              </div>
            </div>
          </article>
          );
        })}
      </div>
      </div>
      {slides.length > 1 ? (
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <div className="flex gap-1.5 rounded-full bg-black/35 px-2 py-1.5 backdrop-blur">
            {slides.map((slide, slideIndex) => (
              <button
                key={slide.id}
                type="button"
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  slideIndex === index ? "w-5 bg-white" : "w-1.5 bg-white/55"
                )}
                aria-label={`Show offer ${slideIndex + 1}`}
                aria-current={slideIndex === index ? true : undefined}
                onClick={() => {
                  pause();
                  goTo(slideIndex);
                  resumeSoon();
                }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CategoryScroller({
  categories,
  selected,
  accent,
  onSelect,
}: {
  categories: StoreCategory[];
  selected: string | "all";
  accent: string;
  onSelect: (id: string | "all") => void;
}) {
  const items = [{ id: "all", name: "All", slug: "all" }, ...categories];
  return (
    <nav className="overflow-x-auto py-2 [scrollbar-width:none] sm:py-3 lg:overflow-visible lg:py-3 [&::-webkit-scrollbar]:hidden" aria-label="Product categories" id="categories">
      <div className="flex min-w-max gap-2.5 sm:gap-3 lg:min-w-0 lg:flex-wrap lg:gap-2">
        {items.map((category) => {
          const active = selected === category.id;
          return (
            <button
              key={category.id}
              type="button"
              className="group flex w-14 shrink-0 flex-col items-center gap-1 text-center sm:w-16 sm:gap-1.5 lg:h-10 lg:w-auto lg:flex-row lg:gap-2 lg:rounded-full lg:border lg:bg-white lg:px-3 lg:text-left lg:shadow-sm lg:transition hover:lg:bg-zinc-50"
              aria-current={active ? "page" : undefined}
              onClick={() => onSelect(category.id)}
              style={active ? { borderColor: accent } : undefined}
            >
              <span
                className={cn(
                  "relative flex size-12 items-center justify-center overflow-hidden rounded-full border bg-white text-xs font-bold shadow-sm transition group-active:scale-95 sm:size-14 sm:text-sm lg:size-7 lg:text-[10px] lg:shadow-none",
                  active ? "text-white" : "border-zinc-100 text-zinc-700"
                )}
                style={active ? { backgroundColor: accent, borderColor: accent } : undefined}
              >
                {category.id === "all" ? (
                  "•••"
                ) : category.imageUrl ? (
                  <>
                    <StoreImage src={category.imageUrl} alt="" sizes="56px" />
                    {active ? <span className="absolute inset-0 bg-black/25" /> : null}
                  </>
                ) : (
                  category.name.slice(0, 2).toUpperCase()
                )}
              </span>
              <span className={cn("line-clamp-1 w-full text-[11px] lg:w-auto lg:text-sm", active ? "font-bold" : "text-zinc-600")}>
                {category.name}
              </span>
              <span
                className={cn("h-0.5 w-7 rounded-full transition lg:hidden", active ? "opacity-100" : "opacity-0")}
                style={{ backgroundColor: accent }}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function ProductRow({
  title,
  products,
  cart,
  accent,
  id,
  onOpen,
  onAdd,
  onDecrease,
}: {
  title: string;
  products: StoreProduct[];
  cart: CartLine[];
  accent: string;
  id?: string;
  onOpen: (product: StoreProduct) => void;
  onAdd: (product: StoreProduct) => void;
  onDecrease: (productId: string) => void;
}) {
  if (!products.length) return null;
  return (
    <section className="py-2" id={id}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight text-zinc-950">{title}</h2>
      </div>
      <div className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-3 [scrollbar-width:none] sm:gap-3 [&::-webkit-scrollbar]:hidden">
        {products.map((product) => (
          <div key={product.id} className="min-w-0 snap-start">
            <ProductCard
              product={product}
              quantity={cart.find((line) => line.product.id === product.id)?.quantity ?? 0}
              accent={accent}
              compact
              onOpen={() => onOpen(product)}
              onAdd={() => onAdd(product)}
              onDecrease={() => onDecrease(product.id)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function StoreHome({
  store,
  cart,
  query,
  categoryId,
  searching,
  onQueryChange,
  onCategoryChange,
  onOpenCart,
  onOpenProduct,
  onAdd,
  onDecrease,
  onLoadMore,
}: {
  store: StorePayload;
  cart: CartLine[];
  query: string;
  categoryId: string | "all";
  searching: boolean;
  onQueryChange: (query: string) => void;
  onCategoryChange: (id: string | "all") => void;
  onOpenCart: () => void;
  onOpenProduct: (product: StoreProduct) => void;
  onAdd: (product: StoreProduct) => void;
  onDecrease: (productId: string) => void;
  onLoadMore: () => void;
}) {
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const featuredPool = store.products.featured ?? store.products.items;
  const featured = store.featuredProductIds
    .map((id) => featuredPool.find((product) => product.id === id))
    .filter((product): product is StoreProduct => Boolean(product))
    .slice(0, 8);
  const arrivals = store.products.items.slice(0, 8);
  const bestSellers = (store.products.bestSellers ?? store.products.items.filter((product) => product.bestSeller)).slice(0, 8);
  const showSections = !query.trim() && categoryId === "all";

  return (
    <div
      className={cn(
        "min-h-dvh w-full min-w-0 bg-zinc-50 text-zinc-950",
        count > 0 ? "pb-[calc(7.5rem+env(safe-area-inset-bottom))] lg:pb-8" : "pb-8"
      )}
    >
      <StoreHeader
        store={store}
        query={query}
        count={count}
        onQueryChange={onQueryChange}
        onOpenCart={onOpenCart}
      />

      <div className="mx-auto w-full max-w-7xl px-3 sm:px-5">

        {showSections && store.slides.length ? <HeroSlider slides={store.slides} /> : null}
        <CategoryScroller
          categories={store.categories}
          selected={categoryId}
          accent={store.accentColor}
          onSelect={onCategoryChange}
        />

        {showSections && store.products.items.length >= 4 ? (
          <>
            <ProductRow
              title={featured.length ? "Featured products" : "New arrivals"}
              products={featured.length ? featured : arrivals}
              cart={cart}
              accent={store.accentColor}
              onOpen={onOpenProduct}
              onAdd={onAdd}
              onDecrease={onDecrease}
            />
            {featured.length ? (
              <ProductRow
                title="New arrivals"
                products={arrivals.filter((product) => !store.featuredProductIds.includes(product.id))}
                cart={cart}
                accent={store.accentColor}
                onOpen={onOpenProduct}
                onAdd={onAdd}
                onDecrease={onDecrease}
              />
            ) : null}
            {bestSellers.length ? (
              <ProductRow
                id="best-sellers"
                title="Best sellers"
                products={bestSellers}
                cart={cart}
                accent={store.accentColor}
                onOpen={onOpenProduct}
                onAdd={onAdd}
                onDecrease={onDecrease}
              />
            ) : null}
          </>
        ) : null}

        <section className="py-4" id="all-products">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight">
              {query ? "Search results" : categoryId === "all" ? "All products" : "Products"}
            </h2>
            {searching ? <span className="size-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-800" /> : null}
          </div>
          {store.products.items.length ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(200px,240px))] sm:gap-4 lg:grid-cols-[repeat(auto-fill,minmax(220px,260px))] lg:gap-5">
              {store.products.items.map((product) => (
                <div key={product.id} className="min-w-0">
                  <ProductCard
                    product={product}
                    quantity={cart.find((line) => line.product.id === product.id)?.quantity ?? 0}
                    accent={store.accentColor}
                    onOpen={() => onOpenProduct(product)}
                    onAdd={() => onAdd(product)}
                    onDecrease={() => onDecrease(product.id)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-zinc-200 bg-white px-6 py-12 text-center">
              <p className="font-semibold">{query ? "No products found" : "No products available"}</p>
              <p className="mt-1 text-sm text-zinc-500">
                {query ? "Try a different product or category." : "Please check back again soon."}
              </p>
            </div>
          )}
          {store.products.total > store.products.items.length ? (
            <button
              type="button"
              className="mt-5 h-11 w-full rounded-2xl border border-zinc-200 bg-white text-sm font-semibold transition active:scale-[0.99]"
              onClick={onLoadMore}
            >
              Load more products
            </button>
          ) : null}
        </section>
      </div>
      <StorefrontFooter footer={store.footer} />
    </div>
  );
}
