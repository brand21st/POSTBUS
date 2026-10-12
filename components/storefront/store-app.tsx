"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import { MarketplaceHome, EMPTY_FILTERS, type CatalogFilters } from "./marketplace-home";
import { MarketplaceProduct } from "./marketplace-product";
import marketStyles from "./marketplace.module.css";
import { contrastText } from "@/modules/storefront/config";
import { bundleCartLine, cartRequest, ungroupBundle } from "@/modules/storefront/cart";
import { commerceEvent, emitStoreEvent } from "@/modules/storefront/tracking-events";
import { StoreTracking } from "./store-tracking";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ShoppingBag } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { StoreOrderSuccess, type StoreOrderReceipt } from "@/components/storefront/order-success";
import { StoreHome } from "@/components/storefront/store-home";
import { StorePincodeLookup } from "@/components/storefront/store-pincode-lookup";
import { StoreSkeleton } from "@/components/storefront/store-skeleton";
import type { CartLine, StorePayload, StoreProduct, StoreBundle } from "@/components/storefront/store-types";
import { IndiaWhatsappField } from "@/components/auth/india-whatsapp-field";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/hooks/use-api";
import { DEFAULT_INDIAN_STATE, INDIAN_STATE_OPTIONS } from "@/lib/indian-states";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { publicOrderLinkApiPath } from "@/modules/customer-order-links/schema";
import { formatStorePrice } from "@/modules/storefront/pricing";
import { returnPolicyLabel, summarizeReturnPolicy } from "@/modules/products/return-policy";
import { pickStoreRecommendations } from "@/modules/storefront/recommendations";
import { trendingProducts } from "@/modules/storefront/trending";

const checkoutSchema = z.object({
  customerName: z.string().trim().min(2, "Enter your full name."),
  phone: z.string().trim().refine((value) => extractIndiaMobileDigits(value) !== null, "Enter a valid 10-digit mobile number."),
  line1: z.string().trim().min(3, "Enter your delivery address."),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(2, "Enter your city."),
  state: z.string().trim().min(2, "Select your state."),
  pincode: z.string().trim().regex(/^\d{6}$/, "Enter a valid 6-digit PIN code."),
  paymentPreference: z.enum(["PREPAID", "COD"]).optional(),
});

type CheckoutValues = z.infer<typeof checkoutSchema> & { quoteVersion?: string };
type StoreRef = { workspace?: string; publicId?: string; token?: string };
const CartSheet = dynamic(() => import("./cart-sheet").then((m) => m.CartSheet));
const ProductDetailSheet = dynamic(() => import("./product-detail-sheet").then((m) => m.ProductDetailSheet));

function cartKey(workspace: string) {
  return `postbus-store-cart:${workspace}`;
}

function catalogParams(ref: StoreRef, page: number, pageSize: number, query: string, categoryId: string, filters: CatalogFilters = EMPTY_FILTERS) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (ref.workspace) params.set("workspace", ref.workspace);
  if (ref.publicId) params.set("code", ref.publicId);
  if (ref.token) params.set("token", ref.token);
  if (query.trim()) params.set("q", query.trim());
  if (categoryId !== "all") params.set("categoryId", categoryId);
  params.set("sort", filters.sort);
  if (filters.priceMin !== "") params.set("priceMin", filters.priceMin);
  if (filters.priceMax !== "") params.set("priceMax", filters.priceMax);
  if (filters.inStock) params.set("inStock", "true");
  return params;
}

export function StoreApp({
  workspace,
  publicId,
  token,
  initialStore,
  initialProduct,
  initialCategoryId = "all",
  preview,
}: StoreRef & {
  initialStore?: StorePayload | null;
  initialProduct?: StoreProduct | null;
  initialCategoryId?: string;
  preview?: StorePayload | null;
}) {
  const isPreview = Boolean(preview);
  const [loadedStore, setLoadedStore] = useState<StorePayload | null>(initialStore ?? null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS);
  const [urlReady, setUrlReady] = useState(false);
  const browseUrl = useRef<string | null>(null);
  const browseScroll = useRef(0);
  const pushedProduct = useRef(false);
  const onProductPath = useRef(false);
  const [categoryId, setCategoryId] = useState<string | "all">(initialCategoryId);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartReady, setCartReady] = useState(isPreview);
  const [sheet, setSheet] = useState<"cart" | "checkout" | null>(null);
  const [checkoutStep, setCheckoutStep] = useState<"details" | "summary">("details");
  const [product, setProduct] = useState<StoreProduct | null>(initialProduct ?? null);
  const [orderReceipt, setOrderReceipt] = useState<StoreOrderReceipt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const submissionIdRef = useRef<string | null>(null);
  const dismissReceipt = useCallback(() => setOrderReceipt(null), []);
  const apiRef = useMemo(() => ({ workspace, publicId, token }), [workspace, publicId, token]);
  const workspaceKey = workspace || initialStore?.workspace || preview?.workspace || "preview";
  useEffect(() => {
    if (isPreview) return;
    const read = () => {
      const params = new URLSearchParams(window.location.search);
      const nextOnProduct = window.location.pathname.includes("/products/");
      setQuery(params.get("q") ?? "");
      setCategoryId(params.get("category") ?? initialCategoryId);
      setFilters({ sort: params.get("sort") ?? "newest", priceMin: params.get("priceMin") ?? "", priceMax: params.get("priceMax") ?? "", inStock: params.get("inStock") === "true" });
      if (onProductPath.current && !nextOnProduct) {
        pushedProduct.current = false;
        setProduct(null);
        const y = browseScroll.current;
        requestAnimationFrame(() => window.scrollTo(0, y));
      }
      onProductPath.current = nextOnProduct;
      setUrlReady(true);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [initialCategoryId, isPreview]);
  useEffect(() => {
    if (!urlReady || isPreview || product) return;
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries({ q: query, category: categoryId === "all" ? "" : categoryId, sort: filters.sort === "newest" ? "" : filters.sort, priceMin: filters.priceMin, priceMax: filters.priceMax, inStock: filters.inStock ? "true" : "" })) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    window.history.replaceState(window.history.state, "", url);
  }, [categoryId, filters, isPreview, product, query, urlReady]);

  const loadStore = useCallback(async () => {
    if (isPreview) return;
    setLoadError(false);
    const params = new URLSearchParams();
    if (workspace) params.set("workspace", workspace);
    if (publicId) params.set("code", publicId);
    if (token) params.set("token", token);
    try {
      setLoadedStore(await api<StorePayload>(`/api/v1/public/store?${params}`));
    } catch {
      setLoadError(true);
    }
  }, [isPreview, publicId, token, workspace]);

  useEffect(() => {
    if (preview || initialStore) return;
    const task = window.setTimeout(() => void loadStore(), 0);
    return () => window.clearTimeout(task);
  }, [initialStore, loadStore, preview]);

  useEffect(() => {
    if (isPreview) return;
    const task = window.setTimeout(() => {
      try {
        const saved = sessionStorage.getItem(cartKey(workspaceKey));
        if (saved) {
          const parsed = JSON.parse(saved) as CartLine[];
          if (Array.isArray(parsed)) setCart(parsed.filter((line) => line?.product?.id && line.quantity > 0));
        }
      } catch {
        sessionStorage.removeItem(cartKey(workspaceKey));
      } finally {
        setCartReady(true);
      }
    }, 0);
    return () => window.clearTimeout(task);
  }, [isPreview, workspaceKey]);

  useEffect(() => {
    if (!cartReady || isPreview) return;
    sessionStorage.setItem(cartKey(workspaceKey), JSON.stringify(cart));
  }, [cart, cartReady, isPreview, workspaceKey]);

  useEffect(() => {
    const modalOpen = Boolean(sheet || product);
    if (!modalOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [product, sheet]);

  const store = useMemo(() => {
    const current = preview ?? loadedStore;
    if (!current || !preview) return current;
    const needle = query.trim().toLowerCase();
    const matchingCategoryIds = new Set(
      preview.categories
        .filter((category) => category.name.toLowerCase().includes(needle))
        .map((category) => category.id)
    );
    const items = preview.products.items.filter(
      (item) =>
        (categoryId === "all" || item.categoryIds?.includes(categoryId)) &&
        (!needle ||
          item.name.toLowerCase().includes(needle) ||
          item.sku.toLowerCase().includes(needle) ||
          item.categoryIds?.some((id) => matchingCategoryIds.has(id)))
    ).filter((item) => (!filters.inStock || item.inStock) && (filters.priceMin === "" || item.price >= Number(filters.priceMin)) && (filters.priceMax === "" || item.price <= Number(filters.priceMax)))
      .sort((a, b) => filters.sort === "priceAsc" ? a.price - b.price : filters.sort === "priceDesc" ? b.price - a.price : filters.sort === "name" ? a.name.localeCompare(b.name) : 0);
    return { ...current, products: { ...current.products, items, total: items.length, page: 1 } };
  }, [categoryId, filters, loadedStore, preview, query]);

  const catalogPool = useMemo(() => {
    const items = [...(store?.products.items ?? []), ...(store?.products.related ?? [])];
    const map = new Map<string, StoreProduct>();
    for (const item of items) map.set(item.id, item);
    return [...map.values()];
  }, [store]);

  useEffect(() => {
    if (isPreview || !urlReady) return;
    if (requestSequence.current === 0 && !query.trim() && categoryId === "all" && JSON.stringify(filters) === JSON.stringify(EMPTY_FILTERS)) {
      requestSequence.current = 1;
      return;
    }
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const products = await api<StorePayload["products"]>(
          `/api/v1/public/store/products?${catalogParams(apiRef, 1, 24, query, categoryId, filters)}`, { signal: controller.signal }
        );
        if (sequence === requestSequence.current) {
          setLoadedStore((current) => (current ? { ...current, products } : current));
        }
      } catch {
        // Preserve the last usable catalog during transient network failures.
      } finally {
        if (sequence === requestSequence.current) setSearching(false);
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [apiRef, categoryId, filters, isPreview, query, urlReady]);

  const seenCovers = useRef(new Set<string>());

  function trackEvent(
    eventType: "PRODUCT_VIEW" | "PRODUCT_CLICK" | "ADD_TO_CART" | "CART_OPENED" | "CHECKOUT_STARTED" | "PURCHASE" | "COVER_IMPRESSION" | "COVER_CLICK",
    details?: { productId?: string; quantity?: number; value?: number; slideId?: string }
  ) {
    const names = { PRODUCT_VIEW: "view_item", PRODUCT_CLICK: "select_item", ADD_TO_CART: "add_to_cart", CART_OPENED: "view_cart", CHECKOUT_STARTED: "begin_checkout", PURCHASE: "purchase" } as const;
    const item = catalogPool.find((candidate) => candidate.id === details?.productId);
    if (eventType !== "PURCHASE" && eventType !== "COVER_IMPRESSION" && eventType !== "COVER_CLICK") {
      emitStoreEvent(workspaceKey, commerceEvent(names[eventType], { value: details?.value, items: item ? [{ item_id: item.id, item_name: item.name, price: item.price, quantity: details?.quantity ?? 1 }] : cart.map((line) => ({ item_id: line.product.id, item_name: line.product.name, price: line.product.price, quantity: line.quantity })) }));
    }
    if (isPreview) return;
    const sessionKey = `postbus-store-session:${workspaceKey}`;
    const sessionId = sessionStorage.getItem(sessionKey) || crypto.randomUUID();
    sessionStorage.setItem(sessionKey, sessionId);
    void fetch("/api/v1/public/store/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        workspace: apiRef.workspace,
        code: apiRef.publicId,
        token: apiRef.token,
        sessionId,
        eventType,
        device: window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop",
        ...details,
      }),
    }).catch(() => undefined);
  }

  function closeProduct() {
    setProduct(null);
    if (isPreview) return;
    const y = browseScroll.current;
    if (pushedProduct.current) {
      pushedProduct.current = false;
      onProductPath.current = false;
      window.history.back();
    } else if (window.location.pathname.includes("/products/")) {
      onProductPath.current = false;
      window.history.replaceState(window.history.state, "", browseUrl.current ?? `/store/${workspaceKey}`);
    }
    requestAnimationFrame(() => window.scrollTo(0, y));
  }

  function openProduct(next: StoreProduct) {
    if (!isPreview && !product) { browseUrl.current = window.location.href; browseScroll.current = window.scrollY; }
    if (!isPreview && next.slug && !window.location.pathname.endsWith(`/products/${next.slug}`)) {
      const url = `/store/${workspaceKey}/products/${next.slug}`;
      if (product || window.location.pathname.includes("/products/")) window.history.replaceState({ storefrontProduct: next.slug }, "", url);
      else {
        window.history.pushState({ storefrontProduct: next.slug }, "", url);
        pushedProduct.current = true;
      }
      onProductPath.current = true;
    }
    setProduct(next);
    trackEvent("PRODUCT_CLICK", { productId: next.id });
    trackEvent("PRODUCT_VIEW", { productId: next.id });
  }

  function openCart() {
    setSheet("cart");
    trackEvent("CART_OPENED", { value: cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0) });
    if (!isPreview && cart.length) {
      void Promise.all(
        cart.map(async (line) => {
          if (line.bundle) return line;
          try {
            const params = catalogParams(apiRef, 1, 1, "", "all");
            params.set("id", line.product.id);
            const current = await api<StoreProduct>(`/api/v1/public/store/product?${params}`);
            return { product: current, quantity: Math.min(line.quantity, current.onHand) };
          } catch {
            return line;
          }
        })
      ).then((lines) => setCart(lines.filter((line) => line.quantity > 0)));
    }
  }

  function addToCart(next: StoreProduct) {
    if (!next.inStock) return;
    trackEvent("ADD_TO_CART", { productId: next.id, quantity: 1, value: next.price });
    setCart((current) => {
      const existing = current.find((line) => line.product.id === next.id);
      if (!existing) return [...current, { product: next, quantity: 1 }];
      const quantity = Math.min(next.onHand, existing.quantity + 1);
      return current.map((line) => (line.product.id === next.id ? { ...line, product: next, quantity } : line));
    });
  }

  function addBundle(bundle: StoreBundle) {
    emitStoreEvent(workspaceKey, commerceEvent("add_bundle", { value: bundle.total, items: bundle.components.map((item) => ({ item_id: item.product.id, item_name: item.product.name, price: item.product.price, quantity: item.quantity })) }));
    const next = bundleCartLine(bundle);
    setCart((current) => {
      const existing = current.find((line) => line.product.id === next.product.id);
      if (existing) return current.map((line) => line === existing ? { ...next, quantity: Math.min(next.product.onHand, line.quantity + 1) } : line);
      return [...current, next];
    });
  }

  function submissionId() {
    if (submissionIdRef.current) return submissionIdRef.current;
    const key = `postbus-store-submit:${workspaceKey}`;
    const saved = sessionStorage.getItem(key);
    const next = saved || crypto.randomUUID();
    sessionStorage.setItem(key, next);
    submissionIdRef.current = next;
    return next;
  }

  function decrease(productId: string) {
    const item = cart.find((line) => line.product.id === productId);
    if (item) emitStoreEvent(workspaceKey, commerceEvent("remove_from_cart", { value: item.product.price, items: [{ item_id: productId, item_name: item.product.name, price: item.product.price, quantity: 1 }] }));
    setCart((current) =>
      current
        .map((line) => (line.product.id === productId ? { ...line, quantity: line.quantity - 1 } : line))
        .filter((line) => line.quantity > 0)
    );
  }

  async function loadMore() {
    if (!store || isPreview || searching) return;
    const sequence = requestSequence.current;
    setSearching(true);
    try {
      const products = await api<StorePayload["products"]>(
        `/api/v1/public/store/products?${catalogParams(
          apiRef,
          store.products.page + 1,
          store.products.pageSize,
          query,
          categoryId,
          filters
        )}`
      );
      if (sequence !== requestSequence.current) return;
      setLoadedStore((current) =>
        current
          ? { ...current, products: { ...products, items: [...current.products.items, ...products.items] } }
          : current
      );
    } catch {
      setSubmitError("Could not load more products. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  if (loadError) {
    return (
      <div className="flex min-h-[70dvh] items-center justify-center px-6 text-center">
        <div>
          <p className="text-xl font-bold">Something went wrong</p>
          <p className="mt-2 text-sm text-zinc-500">The store could not be loaded. Please try again.</p>
          <Button type="button" className="mt-5" onClick={() => void loadStore()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!store) return <StoreSkeleton />;

  if (!store.published && !isPreview) {
    return (
      <div className="flex min-h-[70dvh] items-center justify-center px-6 text-center">
        <div>
          <p className="text-xl font-bold">{store.storeName}</p>
          <p className="mt-2 text-sm text-zinc-500">Store temporarily unavailable.</p>
        </div>
      </div>
    );
  }

  if (orderReceipt) {
    return <><StoreOrderSuccess receipt={orderReceipt} onContinue={dismissReceipt} />{store.marketplace ? <StoreTracking workspace={workspaceKey} config={store.tracking} preview={isPreview} /> : null}</>;
  }

  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const total = cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  const recommendations = pickStoreRecommendations(
    catalogPool,
    cart,
    cart.flatMap((line) => line.product.crossSellIds ?? []),
    { limit: 3 }
  );
  const related = pickStoreRecommendations(
    catalogPool,
    cart,
    product?.upsellIds ?? [],
    { categoryIds: product?.categoryIds, excludeId: product?.id, limit: 8 }
  );

  return (
    <div className={store.marketplace ? marketStyles.store : undefined} data-font={store.theme?.font ?? "geist"} style={store.marketplace ? { "--accent": store.accentColor, "--accent-text": contrastText(store.accentColor), "--secondary": store.theme?.secondaryColor, paddingBottom: product ? 0 : count ? 80 : 0 } as CSSProperties : undefined}>
      {store.marketplace ? <MarketplaceHome store={store} cart={cart} query={query} categoryId={categoryId} searching={searching} filters={filters} onFilters={setFilters} onQueryChange={(value) => { setQuery(value); if (product) { pushedProduct.current = false; onProductPath.current = false; setProduct(null); } }} onCategoryChange={setCategoryId} onOpenCart={openCart} onOpenProduct={openProduct} onAdd={addToCart} onDecrease={decrease} onLoadMore={() => void loadMore()} onBundle={addBundle} onHome={closeProduct} onCoverEvent={(type, slideId) => {
          if (type === "COVER_IMPRESSION") {
            if (seenCovers.current.has(slideId)) return;
            seenCovers.current.add(slideId);
          }
          trackEvent(type, { slideId });
        }} detail={product ? <MarketplaceProduct product={product} quantity={cart.find((line) => line.product.id === product.id)?.quantity ?? 0} related={related} onBack={closeProduct} onAdd={addToCart} onDecrease={decrease} onOpenProduct={openProduct} /> : undefined} /> : <StoreHome
        store={store}
        cart={cart}
        query={query}
        categoryId={categoryId}
        searching={searching}
        onQueryChange={setQuery}
        onCategoryChange={setCategoryId}
        onOpenCart={openCart}
        onOpenProduct={openProduct}
        onAdd={addToCart}
        onDecrease={decrease}
        onLoadMore={() => void loadMore()}
        onCoverEvent={(type, slideId) => {
          if (type === "COVER_IMPRESSION") {
            if (seenCovers.current.has(slideId)) return;
            seenCovers.current.add(slideId);
          }
          trackEvent(type, { slideId });
        }}
      />}

      {count > 0 && !sheet && !product ? (
        <div className="fixed inset-x-0 bottom-0 z-40 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4 lg:inset-x-auto lg:bottom-5 lg:right-6 lg:w-[22rem] lg:px-0 lg:pb-0">
          <button
            type="button"
            className="mx-auto flex h-12 w-full max-w-xl items-center gap-2 rounded-2xl bg-white px-2 text-left shadow-[0_12px_40px_rgba(0,0,0,0.22)] ring-1 ring-zinc-200 transition active:scale-[0.99] sm:h-14 sm:gap-3 sm:px-3 lg:mx-0 lg:max-w-none"
            onClick={openCart}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white sm:size-11" style={{ backgroundColor: store.accentColor }}>
              <ShoppingBag className="size-4 sm:size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] text-zinc-500 sm:text-xs">{count} {count === 1 ? "item" : "items"}</span>
              <span className="block truncate text-sm font-bold sm:text-base">{formatStorePrice(total)}</span>
            </span>
            <span className="shrink-0 rounded-xl px-2.5 py-2 text-xs font-bold text-white sm:px-4 sm:py-2.5 sm:text-sm" style={{ backgroundColor: store.accentColor }}>
              Cart
            </span>
          </button>
        </div>
      ) : null}

      {product && !store.marketplace ? (
        <ProductDetailSheet
          product={product}
          quantity={cart.find((line) => line.product.id === product.id)?.quantity ?? 0}
          accent={store.accentColor}
          related={related}
          cart={cart}
          onClose={closeProduct}
          onAdd={addToCart}
          onDecrease={decrease}
          onOpenProduct={openProduct}
        />
      ) : null}

      {sheet ? (
        <CartSheet
          onUngroup={(id) => setCart((current) => ungroupBundle(current, id))}
          cart={cart}
          accent={store.accentColor}
          checkout={sheet === "checkout"}
          recommendations={recommendations}
          suggestions={trendingProducts([...(store.products.bestSellers ?? []), ...(store.products.featured ?? []), ...catalogPool])}
          checkoutForm={
            <CheckoutForm
              apiRef={apiRef}
              preview={isPreview}
              cart={cart}
              submitting={submitting}
              error={submitError}
              step={checkoutStep}
              onStepChange={setCheckoutStep}
              onSubmit={async (values) => {
                const path = publicOrderLinkApiPath(apiRef, "submit");
                if (!path) {
                  setSubmitError("This store link is not valid.");
                  return;
                }
                setSubmitting(true);
                setSubmitError(null);
                try {
                  const result = await api<{
                    status: string;
                    orderId?: string;
                    items?: Array<{ productId: string; name: string; unitPrice: number; quantity: number }>;
                    orderNumber?: string | null;
                    total?: number;
                    advanceAmount?: number;
                    codAmount?: number;
                    paymentMethod?: string;
                    returnPolicy?: string;
                  }>(path, {
                    method: "POST",
                    body: JSON.stringify({
                      ...values,
                      clientRequestId: submissionId(),
                      ...cartRequest(cart),
                    }),
                  });
                  sessionStorage.removeItem(`postbus-store-submit:${workspaceKey}`);
                  submissionIdRef.current = null;
                  setCart([]);
                  setSheet(null);
                  setCheckoutStep("details");
                  setOrderReceipt({
                    orderNumber: result.orderNumber ?? "",
                    total: Number(result.total ?? 0),
                    advanceAmount: Number(result.advanceAmount ?? 0),
                    codAmount: Number(result.codAmount ?? 0),
                    paymentMethod: result.paymentMethod ?? "Prepaid",
                    returnPolicy: result.returnPolicy ?? summarizeReturnPolicy(cart.map((line) => line.product.returnAvailable !== false)).label,
                  });
                  if (result.orderId) emitStoreEvent(workspaceKey, commerceEvent("purchase", { eventId: `order:${result.orderId}`, transactionId: result.orderId, value: Number(result.total ?? 0), items: result.items?.map((item) => ({ item_id: item.productId, item_name: item.name, price: item.unitPrice, quantity: item.quantity })) }));
                  trackEvent("PURCHASE", { value: Number(result.total ?? 0) });
                } catch (error) {
                  setSubmitError(error instanceof Error ? error.message : "Could not submit this order. Please try again.");
                } finally {
                  setSubmitting(false);
                }
              }}
            />
          }
          checkoutStep={checkoutStep}
          onClose={() => {
            setSheet(null);
            setSubmitError(null);
            setCheckoutStep("details");
          }}
          onCheckout={() => {
            setProduct(null);
            setCheckoutStep("details");
            setSheet("checkout");
            trackEvent("CHECKOUT_STARTED", { value: total });
          }}
          onBack={() => {
            if (checkoutStep === "summary") {
              setCheckoutStep("details");
              return;
            }
            setSheet("cart");
          }}
          onAdd={addToCart}
          onDecrease={decrease}
          onRemove={(productId) => setCart((current) => current.filter((line) => line.product.id !== productId))}
        />
      ) : null}
      {store.marketplace ? <StoreTracking workspace={workspaceKey} config={store.tracking} preview={isPreview} /> : null}
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs text-red-600">{message}</p> : null;
}

function CheckoutForm({
  apiRef,
  preview = false,
  cart,
  submitting,
  error,
  step,
  onStepChange,
  onSubmit,
}: {
  apiRef: StoreRef;
  preview?: boolean;
  cart: CartLine[];
  submitting: boolean;
  error: string | null;
  step: "details" | "summary";
  onStepChange: (step: "details" | "summary") => void;
  onSubmit: (values: CheckoutValues) => Promise<void>;
}) {
  const form = useForm<CheckoutValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      customerName: "",
      phone: "",
      line1: "",
      line2: "",
      city: "",
      state: DEFAULT_INDIAN_STATE,
      pincode: "",
      paymentPreference: cart.every((line) => line.product.codEnabled) ? "COD" : "PREPAID",
    },
  });
  const pincode = useWatch({ control: form.control, name: "pincode" });
  const resolvePincode = useCallback(
    (city: string, state: string) => {
      if (city && form.getValues("city").trim() !== city) {
        form.setValue("city", city, { shouldDirty: true, shouldValidate: true });
      }
      if (state && form.getValues("state") !== state) {
        form.setValue("state", state, { shouldDirty: true, shouldValidate: true });
      }
    },
    [form]
  );
  const prepaid = cart.every((line) => line.product.prepaidEnabled);
  const cod = cart.every((line) => line.product.codEnabled);
  const preference = useWatch({ control: form.control, name: "paymentPreference" }) ?? (cod ? "COD" : "PREPAID");
  const productAmount = cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  const returns = summarizeReturnPolicy(cart.map((line) => line.product.returnAvailable !== false));
  const quote = useQuery({
    queryKey: ["store-quote", apiRef, preference, cart.map((line) => `${line.product.id}:${line.quantity}`).join(",")],
    enabled: !preview && Boolean(cart.length && (preference === "PREPAID" || preference === "COD") && (prepaid || cod)),
    queryFn: () =>
      api<{ total: number; amountDueNow: number; amountOnDelivery: number; expectedAdvance: number; quoteVersion: string }>(
        "/api/v1/public/store/quote",
        {
          method: "POST",
          body: JSON.stringify({
            workspace: apiRef.workspace,
            code: apiRef.publicId,
            token: apiRef.token,
            paymentPreference: preference,
            ...cartRequest(cart),
          }),
        }
      ),
  });
  const watchedName = useWatch({ control: form.control, name: "customerName" });
  const watchedPhone = useWatch({ control: form.control, name: "phone" });
  const detailsDone = step === "summary";
  const phoneDigits = extractIndiaMobileDigits(watchedPhone ?? "") ?? "";

  return (
    <form
      data-clarity-mask="true"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onSubmit={form.handleSubmit(async (values) => {
        if (step !== "summary") {
          onStepChange("summary");
          return;
        }
        if (preview) return;
        const fresh = await quote.refetch();
        if (!fresh.data || fresh.error) return;
        if (fresh.data.quoteVersion !== quote.data?.quoteVersion) { form.setError("root", { message: "Prices changed. Review the updated total and place your order again." }); return; }
        await onSubmit({ ...values, quoteVersion: fresh.data.quoteVersion });
      })}
      noValidate
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-4 [scrollbar-width:none] md:px-6 md:py-5 [&::-webkit-scrollbar]:hidden">
        <ol className="mx-auto max-w-lg">
          <li className="flex gap-3" aria-current={step === "details" ? "step" : undefined}>
            <div className="flex w-7 shrink-0 flex-col items-center">
              <span
                className={`relative z-10 flex size-7 items-center justify-center rounded-full border text-xs font-semibold ${
                  detailsDone ? "border-brand bg-brand text-white" : "border-brand bg-white text-brand"
                }`}
              >
                {detailsDone ? <Check className="size-3.5" aria-hidden="true" /> : "1"}
              </span>
              <span className={`mt-1 w-px flex-1 min-h-6 ${detailsDone ? "bg-brand/40" : "bg-zinc-200"}`} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1 pb-6">
              {detailsDone ? (
                <button type="button" className="block w-full text-left" onClick={() => onStepChange("details")}>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Customer details</p>
                  <p className="mt-1 truncate text-sm text-zinc-700">
                    {[watchedName?.trim(), phoneDigits ? `+91 ${phoneDigits}` : null].filter(Boolean).join(" · ")}
                  </p>
                </button>
              ) : (
                <div className="space-y-5">
                  <section className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Customer details</h3>
                    <div>
                      <Label htmlFor="customer-name">Full name</Label>
                      <Input id="customer-name" className="mt-1 h-11" autoComplete="name" {...form.register("customerName")} />
                      <FieldError message={form.formState.errors.customerName?.message} />
                    </div>
                    <div>
                      <IndiaWhatsappField control={form.control} name="phone" />
                      <FieldError message={form.formState.errors.phone?.message} />
                    </div>
                  </section>
                  <section className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Delivery address</h3>
                    <div>
                      <Label htmlFor="delivery-address">Address</Label>
                      <Input id="delivery-address" className="mt-1 h-11" autoComplete="street-address" {...form.register("line1")} />
                      <FieldError message={form.formState.errors.line1?.message} />
                    </div>
                    <div>
                      <Label htmlFor="delivery-area">Area / locality</Label>
                      <Input id="delivery-area" className="mt-1 h-11" {...form.register("line2")} />
                      <FieldError message={form.formState.errors.line2?.message} />
                    </div>
                    <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
                      <div>
                        <Label htmlFor="delivery-pincode">PIN code</Label>
                        <Input id="delivery-pincode" className="mt-1 h-11" inputMode="numeric" autoComplete="postal-code" maxLength={6} {...form.register("pincode")} />
                        <FieldError message={form.formState.errors.pincode?.message} />
                      </div>
                      <div>
                        <Label htmlFor="delivery-city">City</Label>
                        <Input id="delivery-city" className="mt-1 h-11" autoComplete="address-level2" {...form.register("city")} />
                        <FieldError message={form.formState.errors.city?.message} />
                      </div>
                    </div>
                    <StorePincodeLookup linkRef={apiRef} pincode={pincode} onResolve={resolvePincode} />
                    <div>
                      <Label>State</Label>
                      <Controller
                        control={form.control}
                        name="state"
                        render={({ field }) => (
                          <Combobox className="mt-1" options={INDIAN_STATE_OPTIONS} value={field.value} onChange={field.onChange} />
                        )}
                      />
                      <FieldError message={form.formState.errors.state?.message} />
                    </div>
                  </section>
                </div>
              )}
            </div>
          </li>
          <li className="flex gap-3" aria-current={step === "summary" ? "step" : undefined}>
            <div className="flex w-7 shrink-0 flex-col items-center">
              <span
                className={`relative z-10 flex size-7 items-center justify-center rounded-full border text-xs font-semibold ${
                  step === "summary" ? "border-brand bg-white text-brand" : "border-zinc-200 bg-zinc-50 text-zinc-400"
                }`}
              >
                2
              </span>
            </div>
            <div className="min-w-0 flex-1 pb-2">
              <h3 className={`text-xs font-bold uppercase tracking-[0.16em] ${step === "summary" ? "text-zinc-500" : "text-zinc-300"}`}>
                Order summary
              </h3>
              {step === "summary" ? (
                <div className="mt-3 space-y-4">
                  <section className="space-y-2 rounded-2xl bg-zinc-50 p-3 text-sm">
                    {cart.map((line) => (
                      <div key={line.product.id} className="flex justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{line.product.name}</span>
                          {line.bundle ? <span className="block text-xs text-zinc-500">{line.bundle.components.map((item) => `${item.quantity} × ${item.product.name}`).join(" + ")}</span> : null}
                          <span className="text-xs text-zinc-500">
                            Qty {line.quantity}
                            {line.product.sku ? ` · ${line.product.sku}` : ""} · {returnPolicyLabel(line.product.returnAvailable !== false)}
                          </span>
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums">{formatStorePrice(line.product.price * line.quantity)}</span>
                      </div>
                    ))}
                  </section>
                  {prepaid || cod ? (
                    <fieldset className="min-w-0 rounded-2xl border border-zinc-200 p-3">
                      <legend className="px-1 text-sm font-semibold">Payment summary</legend>
                      <p className="mb-3 text-xs leading-5 text-zinc-500">Pay the merchant using these amounts. India Post shipment starts after confirmation.</p>
                      <div className="grid min-w-0 gap-2">
                        {prepaid ? (
                          <label className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2 text-sm">
                            <input type="radio" value="PREPAID" className="shrink-0" {...form.register("paymentPreference")} />
                            <span className="min-w-0">
                              <span className="block font-semibold">Prepaid — full amount</span>
                              <span className="text-xs text-zinc-500">{formatStorePrice(quote.data?.total ?? productAmount)}</span>
                            </span>
                          </label>
                        ) : null}
                        {cod ? (
                          <label className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2 text-sm">
                            <input type="radio" value="COD" className="shrink-0" {...form.register("paymentPreference")} />
                            <span className="min-w-0">
                              <span className="block font-semibold">Cash on delivery</span>
                              {quote.data && preference === "COD" && quote.data.amountDueNow > 0 ? (
                                <span className="block text-xs leading-5 text-zinc-500">
                                  Advance {formatStorePrice(quote.data.amountDueNow)} · COD {formatStorePrice(quote.data.amountOnDelivery)}
                                </span>
                              ) : (
                                <span className="text-xs text-zinc-500">Pay the full amount on delivery.</span>
                              )}
                            </span>
                          </label>
                        ) : null}
                      </div>
                      <dl className="mt-3 min-w-0 space-y-1.5 rounded-xl bg-white p-3 text-sm">
                        <div className="flex min-w-0 justify-between gap-3">
                          <dt className="min-w-0 text-zinc-500">Product amount</dt>
                          <dd className="shrink-0 font-semibold tabular-nums">{formatStorePrice(quote.data?.total ?? productAmount)}</dd>
                        </div>
                        <div className="flex min-w-0 justify-between gap-3">
                          <dt className="min-w-0 text-zinc-500">Advance payment</dt>
                          <dd className="shrink-0 font-semibold tabular-nums">
                            {formatStorePrice(preference === "COD" ? (quote.data?.amountDueNow ?? 0) : 0)}
                          </dd>
                        </div>
                        <div className="flex min-w-0 justify-between gap-3">
                          <dt className="min-w-0 text-zinc-500">COD amount</dt>
                          <dd className="shrink-0 font-semibold tabular-nums">
                            {formatStorePrice(preference === "COD" ? (quote.data?.amountOnDelivery ?? quote.data?.total ?? productAmount) : 0)}
                          </dd>
                        </div>
                        <div className="flex min-w-0 justify-between gap-3 border-t border-zinc-100 pt-2 text-base">
                          <dt className="min-w-0 font-bold">Final total</dt>
                          <dd className="shrink-0 font-bold tabular-nums">{formatStorePrice(quote.data?.total ?? productAmount)}</dd>
                        </div>
                      </dl>
                      {quote.data && preference === "COD" && quote.data.amountDueNow > 0 ? (
                        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
                          Advance payment of {formatStorePrice(quote.data.amountDueNow)} is required to confirm this order.
                        </p>
                      ) : null}
                    </fieldset>
                  ) : (
                    <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-700">These products cannot be ordered together. Remove prepaid-only or COD-only items.</p>
                  )}
                  <section className="rounded-2xl border border-zinc-200 p-3">
                    <h3 className="text-sm font-semibold">Return policy</h3>
                    <p className="mt-1 text-sm text-zinc-700">{returns.label}</p>
                    {returns.kind === "mixed" ? (
                      <ul className="mt-2 space-y-1 text-xs text-zinc-500">
                        {cart.map((line) => (
                          <li key={line.product.id} className="flex justify-between gap-2">
                            <span className="min-w-0 truncate">{line.product.name}</span>
                            <span className="shrink-0">{returnPolicyLabel(line.product.returnAvailable !== false)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                  {error ? (
                    <div role="alert" className="rounded-2xl bg-red-50 p-3 text-sm text-red-700">
                      {error}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        </ol>
      </div>
      <div className="mt-auto shrink-0 border-t border-zinc-100 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
        <div className="mx-auto max-w-lg">
          {quote.error || form.formState.errors.root ? <p role="alert" className="mb-2 text-sm text-red-600">{quote.error?.message ?? form.formState.errors.root?.message}</p> : null}
          <Button
            type="submit"
            className="h-12 w-full rounded-2xl"
            disabled={submitting || !cart.length || (step === "summary" && (preview || quote.isFetching || quote.isError || !quote.data || (!prepaid && !cod)))}
          >
            {step === "summary" ? (submitting ? "Placing order…" : "Place order") : "Next"}
          </Button>
        </div>
      </div>
    </form>
  );
}
