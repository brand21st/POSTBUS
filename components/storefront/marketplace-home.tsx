"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Grid2X2, Minus, Plus, Search, ShoppingBag, SlidersHorizontal, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CoverHero } from "./cover-hero";
import { StoreImage } from "./store-image";
import { StorefrontFooter } from "./storefront-footer";
import type { CartLine, StorePayload, StoreProduct, StoreBundle } from "./store-types";
import { formatStorePrice } from "@/modules/storefront/pricing";
import s from "./marketplace.module.css";

export type CatalogFilters = { sort: string; priceMin: string; priceMax: string; inStock: boolean };
export const EMPTY_FILTERS: CatalogFilters = { sort: "newest", priceMin: "", priceMax: "", inStock: false };

function MarketplaceProduct({ product, quantity, onOpen, onAdd, onDecrease }: { product: StoreProduct; quantity: number; onOpen: () => void; onAdd: () => void; onDecrease: () => void }) {
  return <article className={s.product}>
    <button className={s.productImage} onClick={onOpen} aria-label={`View ${product.name}`}><StoreImage src={product.imageUrls[0]} alt={product.name} sizes="(max-width: 599px) 46vw, (max-width: 899px) 30vw, 220px" />{product.bestSeller ? <span className={s.label}>Best seller</span> : null}</button>
    <div className={s.productBody}>
      <button className={s.productName} onClick={onOpen}>{product.name}</button>
      <div className={s.price}>{formatStorePrice(product.price)}{product.compareAtPrice && product.compareAtPrice > product.price ? <del>{formatStorePrice(product.compareAtPrice)}</del> : null}</div>
      <div className={s.saving}>{!product.inStock ? "Out of stock" : product.discountPercent ? `${product.discountPercent}% off` : product.onHand <= (product.lowStockThreshold ?? 0) ? `Only ${product.onHand} left` : ""}</div>
      {quantity > 0 ? <div className={s.stepper}><button aria-label={`Decrease ${product.name}`} onClick={onDecrease}><Minus size={15} /></button><span aria-live="polite">{quantity}</span><button disabled={quantity >= product.onHand} aria-label={`Increase ${product.name}`} onClick={onAdd}><Plus size={15} /></button></div> : <button className={s.add} disabled={!product.inStock} onClick={onAdd}><Plus size={15} />{product.inStock ? "Add to cart" : "Unavailable"}</button>}
    </div>
  </article>;
}

export function MarketplaceHome({ store, cart, query, categoryId, searching, filters, onFilters, onQueryChange, onCategoryChange, onOpenCart, onOpenProduct, onAdd, onDecrease, onLoadMore, onBundle, detail, onHome, onCoverEvent }: {
  store: StorePayload; cart: CartLine[]; query: string; categoryId: string; searching: boolean;
  filters: CatalogFilters; onFilters: (filters: CatalogFilters) => void; onQueryChange: (q: string) => void;
  onCategoryChange: (id: string) => void; onOpenCart: () => void; onOpenProduct: (product: StoreProduct) => void;
  onAdd: (product: StoreProduct) => void; onDecrease: (id: string) => void; onLoadMore: () => void; onBundle: (bundle: StoreBundle) => void;
  detail?: ReactNode; onHome?: () => void;
  onCoverEvent?: (type: "COVER_IMPRESSION" | "COVER_CLICK", slideId: string) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const quantities = useMemo(() => new Map(cart.map((line) => [line.product.id, line.quantity])), [cart]);
  const featured = (store.products.featured ?? store.products.items.filter((p) => store.featuredProductIds.includes(p.id))).slice(0, 8);
  const featuredIds = new Set(featured.map((p) => p.id));
  const best = (store.products.bestSellers ?? []).filter((p) => !featuredIds.has(p.id)).slice(0, 8);
  const home = !query && categoryId === "all" && filters.priceMin === "" && filters.priceMax === "" && !filters.inStock;
  const card = (product: StoreProduct) => <MarketplaceProduct key={product.id} product={product} quantity={quantities.get(product.id) ?? 0} onOpen={() => onOpenProduct(product)} onAdd={() => onAdd(product)} onDecrease={() => onDecrease(product.id)} />;
  const filterFields = <div className={s.filterFields}>
    <label>Minimum price<input type="number" min="0" inputMode="decimal" value={filters.priceMin} onChange={(e) => onFilters({ ...filters, priceMin: e.target.value })} placeholder="0" /></label>
    <label>Maximum price<input type="number" min="0" inputMode="decimal" value={filters.priceMax} onChange={(e) => onFilters({ ...filters, priceMax: e.target.value })} placeholder="Any" /></label>
    <label><input type="checkbox" checked={filters.inStock} onChange={(e) => onFilters({ ...filters, inStock: e.target.checked })} />In stock only</label>
    <button className={s.filterButton} style={{ display: "inline-flex" }} onClick={() => { onFilters(EMPTY_FILTERS); onQueryChange(""); onCategoryChange("all"); }}>Clear filters</button>
  </div>;
  const banner = store.slides[0];
  return <>
    <header className={s.header}><div className={`${s.inner} ${s.topbar}`}>
      <a className={s.brand} href={`/store/${store.workspace}`} onClick={(event) => { if (!detail) return; event.preventDefault(); onHome?.(); }}><span className={s.logo}><StoreImage src={store.logoUrl} alt="" sizes="36px" /></span><span>{store.storeName}</span></a>
      <div className={s.search}><Search /><input aria-label="Search products" type="search" value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder="Search products and categories" />{query ? <button aria-label="Clear search" onClick={() => onQueryChange("")}><X size={16} /></button> : null}</div>
      <button className={s.icon} aria-label={`Open cart, ${cart.reduce((n, l) => n + l.quantity, 0)} items`} onClick={onOpenCart}><ShoppingBag size={21} />{cart.length ? <span className={s.badge}>{cart.reduce((n, l) => n + l.quantity, 0)}</span> : null}</button>
    </div></header>
    <div className={s.inner}>
      {detail ?? <>
      <nav className={s.categories} aria-label="Product categories"><button aria-pressed={categoryId === "all"} onClick={() => onCategoryChange("all")}><Grid2X2 size={16} />All products</button>{store.categories.map((c) => <button key={c.id} aria-pressed={categoryId === c.id} onClick={() => onCategoryChange(c.id)}>{c.imageUrl ? <span className={s.categoryImage}><StoreImage src={c.imageUrl} alt="" sizes="26px" /></span> : null}{c.name}</button>)}</nav>
      {home && banner?.imageUrl ? <section className={s.banner} aria-label="Store offer"><CoverHero slide={banner} preload onVisible={() => onCoverEvent?.("COVER_IMPRESSION", banner.id)} onCtaClick={() => onCoverEvent?.("COVER_CLICK", banner.id)} /></section> : null}
      {home && featured.length ? <section className={s.section}><div className={s.sectionHead}><h2>Featured picks</h2></div><div className={s.rail}>{featured.map(card)}</div></section> : null}
      {home && store.bundles?.length ? <section className={s.section}><div className={s.sectionHead}><h2>Better together</h2><span>Bundle offers</span></div><div className={s.rail} style={{ gridAutoColumns: "minmax(240px, 300px)" }}>{store.bundles.map((bundle) => <article key={bundle.id} className={s.bundle}><div className={s.bundleImages}>{bundle.components.slice(0, 3).map((item) => <span key={item.product.id}><StoreImage src={item.product.imageUrls[0]} alt={item.product.name} sizes="60px" /></span>)}</div><h3 className="text-sm font-semibold">{bundle.name}</h3><p className="my-2 text-xs text-zinc-500">{bundle.components.map((c) => `${c.quantity} x ${c.product.name}`).join(" + ")}</p><div className={s.price}>{formatStorePrice(bundle.total)}<del>{formatStorePrice(bundle.subtotal)}</del></div><p className={`${s.saving} my-1`}>Save {formatStorePrice(bundle.savings)}</p><button className={`${s.add} w-full`} onClick={() => onBundle(bundle)}><Plus size={15} />Add bundle</button></article>)}</div></section> : null}
      {home && best.length ? <section className={s.section}><div className={s.sectionHead}><h2>Best sellers</h2></div><div className={s.rail}>{best.map(card)}</div></section> : null}
      <section className={s.section} id="all-products"><div className={s.sectionHead}><h2>{query ? "Search results" : store.categories.find((c) => c.id === categoryId)?.name ?? "Shop all products"}</h2><span role="status">{searching ? "Updating..." : `${store.products.total} products`}</span></div>
        <div className={s.catalog}><aside className={s.filters} aria-label="Catalog filters">{filterFields}</aside><div className="min-w-0"><div className={s.toolbar}><button className={s.filterButton} onClick={() => setFiltersOpen(true)}><SlidersHorizontal size={15} />Filters</button><select className={s.sort} aria-label="Sort products" value={filters.sort} onChange={(e) => onFilters({ ...filters, sort: e.target.value })}><option value="newest">Newest first</option><option value="priceAsc">Price: low to high</option><option value="priceDesc">Price: high to low</option><option value="name">Name: A to Z</option></select></div>
        {store.products.items.length ? <div className={s.grid} aria-busy={searching}>{store.products.items.map(card)}</div> : <div className={s.empty}>No products found.<button className="mx-auto mt-3 block underline" onClick={() => { onFilters(EMPTY_FILTERS); onQueryChange(""); onCategoryChange("all"); }}>Clear filters</button></div>}
        {store.products.total > store.products.items.length ? <button className={`${s.filterButton} mx-auto mt-5`} style={{ display: "flex" }} disabled={searching} onClick={onLoadMore}>{searching ? "Loading..." : "Load more products"}</button> : null}</div></div>
      </section>
      </>}
    </div>
    <StorefrontFooter footer={store.footer} />
    <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}><DialogContent className="max-w-sm rounded-lg"><DialogTitle>Filter products</DialogTitle>{filterFields}<button className="h-10 rounded-md bg-zinc-900 text-sm text-white" onClick={() => setFiltersOpen(false)}>Show products</button></DialogContent></Dialog>
  </>;
}
