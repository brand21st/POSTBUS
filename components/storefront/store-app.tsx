"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, ShoppingBag } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { CartSheet } from "@/components/storefront/cart-sheet";
import { ProductDetailSheet } from "@/components/storefront/product-detail-sheet";
import { StoreHome } from "@/components/storefront/store-home";
import { StorePincodeLookup } from "@/components/storefront/store-pincode-lookup";
import { StoreSkeleton } from "@/components/storefront/store-skeleton";
import type { CartLine, StorePayload, StoreProduct } from "@/components/storefront/store-types";
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
import { pickStoreRecommendations } from "@/modules/storefront/recommendations";

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

type CheckoutValues = z.infer<typeof checkoutSchema>;
type StoreRef = { workspace?: string; publicId?: string; token?: string };

function cartKey(workspace: string) {
  return `postbus-store-cart:${workspace}`;
}

function catalogParams(ref: StoreRef, page: number, pageSize: number, query: string, categoryId: string) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (ref.workspace) params.set("workspace", ref.workspace);
  if (ref.publicId) params.set("code", ref.publicId);
  if (ref.token) params.set("token", ref.token);
  if (query.trim()) params.set("q", query.trim());
  if (categoryId !== "all") params.set("categoryId", categoryId);
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
  const [categoryId, setCategoryId] = useState<string | "all">(initialCategoryId);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartReady, setCartReady] = useState(isPreview);
  const [sheet, setSheet] = useState<"cart" | "checkout" | null>(null);
  const [product, setProduct] = useState<StoreProduct | null>(initialProduct ?? null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const submissionIdRef = useRef<string | null>(null);
  const apiRef = useMemo(() => ({ workspace, publicId, token }), [workspace, publicId, token]);
  const workspaceKey = workspace || initialStore?.workspace || preview?.workspace || "preview";

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
    );
    return { ...current, products: { ...current.products, items, total: items.length, page: 1 } };
  }, [categoryId, loadedStore, preview, query]);

  const catalogPool = useMemo(() => {
    const items = [...(store?.products.items ?? []), ...(store?.products.related ?? [])];
    const map = new Map<string, StoreProduct>();
    for (const item of items) map.set(item.id, item);
    return [...map.values()];
  }, [store]);

  useEffect(() => {
    if (isPreview) return;
    if (requestSequence.current === 0 && !query.trim() && categoryId === "all") {
      requestSequence.current = 1;
      return;
    }
    const sequence = ++requestSequence.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const products = await api<StorePayload["products"]>(
          `/api/v1/public/store/products?${catalogParams(apiRef, 1, 24, query, categoryId)}`
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
    return () => window.clearTimeout(timer);
  }, [apiRef, categoryId, isPreview, query]);

  function trackEvent(
    eventType: "PRODUCT_VIEW" | "PRODUCT_CLICK" | "ADD_TO_CART" | "CART_OPENED" | "CHECKOUT_STARTED" | "PURCHASE",
    details?: { productId?: string; quantity?: number; value?: number }
  ) {
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
        ...details,
      }),
    }).catch(() => undefined);
  }

  function openProduct(next: StoreProduct) {
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
    setCart((current) =>
      current
        .map((line) => (line.product.id === productId ? { ...line, quantity: line.quantity - 1 } : line))
        .filter((line) => line.quantity > 0)
    );
  }

  async function loadMore() {
    if (!store || isPreview) return;
    setSearching(true);
    try {
      const products = await api<StorePayload["products"]>(
        `/api/v1/public/store/products?${catalogParams(
          apiRef,
          store.products.page + 1,
          store.products.pageSize,
          query,
          categoryId
        )}`
      );
      setLoadedStore((current) =>
        current
          ? { ...current, products: { ...products, items: [...current.products.items, ...products.items] } }
          : current
      );
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

  if (orderNumber !== null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 text-center">
        <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-xl ring-1 ring-zinc-100">
          <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="size-9" />
          </span>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Order received</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">Thank you for your order!</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500">The merchant will review your order and contact you to confirm payment and delivery.</p>
          {orderNumber ? <p className="mt-4 rounded-2xl bg-zinc-50 p-3 text-sm font-semibold">Reference {orderNumber}</p> : null}
          <Button type="button" className="mt-6 w-full" onClick={() => setOrderNumber(null)}>
            Continue shopping
          </Button>
        </div>
      </div>
    );
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
    { categoryIds: product?.categoryIds, excludeId: product?.id, limit: 4 }
  );

  return (
    <>
      <StoreHome
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
      />

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

      {product ? (
        <ProductDetailSheet
          product={product}
          quantity={cart.find((line) => line.product.id === product.id)?.quantity ?? 0}
          accent={store.accentColor}
          related={related}
          cart={cart}
          onClose={() => setProduct(null)}
          onAdd={addToCart}
          onDecrease={decrease}
          onOpenProduct={openProduct}
        />
      ) : null}

      {sheet ? (
        <CartSheet
          cart={cart}
          accent={store.accentColor}
          checkout={sheet === "checkout"}
          recommendations={recommendations}
          checkoutForm={
            <CheckoutForm
              apiRef={apiRef}
              cart={cart}
              submitting={submitting}
              error={submitError}
              onSubmit={async (values) => {
                const path = publicOrderLinkApiPath(apiRef, "submit");
                if (!path) {
                  setSubmitError("This store link is not valid.");
                  return;
                }
                setSubmitting(true);
                setSubmitError(null);
                try {
                  const result = await api<{ status: string; orderNumber?: string | null }>(path, {
                    method: "POST",
                    body: JSON.stringify({
                      ...values,
                      clientRequestId: submissionId(),
                      items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
                    }),
                  });
                  sessionStorage.removeItem(`postbus-store-submit:${workspaceKey}`);
                  submissionIdRef.current = null;
                  setCart([]);
                  setSheet(null);
                  setOrderNumber(result.orderNumber ?? "");
                  trackEvent("PURCHASE", { value: total });
                } catch (error) {
                  setSubmitError(error instanceof Error ? error.message : "Could not submit this order. Please try again.");
                } finally {
                  setSubmitting(false);
                }
              }}
            />
          }
          onClose={() => {
            setSheet(null);
            setSubmitError(null);
          }}
          onCheckout={() => {
            setSheet("checkout");
            trackEvent("CHECKOUT_STARTED", { value: total });
          }}
          onBack={() => setSheet("cart")}
          onAdd={addToCart}
          onDecrease={decrease}
          onRemove={(productId) => setCart((current) => current.filter((line) => line.product.id !== productId))}
        />
      ) : null}
    </>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs text-red-600">{message}</p> : null;
}

function CheckoutForm({
  apiRef,
  cart,
  submitting,
  error,
  onSubmit,
}: {
  apiRef: StoreRef;
  cart: CartLine[];
  submitting: boolean;
  error: string | null;
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
  const quote = useQuery({
    queryKey: ["store-quote", apiRef, preference, cart.map((line) => `${line.product.id}:${line.quantity}`).join(",")],
    enabled: Boolean(cart.length && (preference === "PREPAID" || preference === "COD") && (prepaid || cod)),
    queryFn: () =>
      api<{ total: number; amountDueNow: number; amountOnDelivery: number; expectedAdvance: number }>(
        "/api/v1/public/store/quote",
        {
          method: "POST",
          body: JSON.stringify({
            workspace: apiRef.workspace,
            code: apiRef.publicId,
            token: apiRef.token,
            paymentPreference: preference,
            items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
          }),
        }
      ),
  });

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <div>
        <Label htmlFor="customer-name">Full name</Label>
        <Input id="customer-name" className="mt-1 h-11" autoComplete="name" {...form.register("customerName")} />
        <FieldError message={form.formState.errors.customerName?.message} />
      </div>
      <div>
        <IndiaWhatsappField control={form.control} name="phone" />
        <FieldError message={form.formState.errors.phone?.message} />
      </div>
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
          <Label htmlFor="delivery-city">City</Label>
          <Input id="delivery-city" className="mt-1 h-11" autoComplete="address-level2" {...form.register("city")} />
          <FieldError message={form.formState.errors.city?.message} />
        </div>
        <div>
          <Label htmlFor="delivery-pincode">PIN code</Label>
          <Input id="delivery-pincode" className="mt-1 h-11" inputMode="numeric" autoComplete="postal-code" maxLength={6} {...form.register("pincode")} />
          <FieldError message={form.formState.errors.pincode?.message} />
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
      {prepaid || cod ? (
        <fieldset className="rounded-2xl border border-zinc-200 p-3">
          <legend className="px-1 text-sm font-semibold">Payment</legend>
          <p className="mb-3 text-xs leading-5 text-zinc-500">No payment is collected here. Pay the merchant using the amount shown, then they will confirm your order.</p>
          <div className="grid gap-2">
            {prepaid ? (
              <label className="flex min-h-11 items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2 text-sm">
                <input type="radio" value="PREPAID" {...form.register("paymentPreference")} />
                <span>
                  <span className="block font-semibold">Pay full amount</span>
                  <span className="text-xs text-zinc-500">{formatStorePrice(quote.data?.total ?? cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0))}</span>
                </span>
              </label>
            ) : null}
            {cod ? (
              <label className="flex min-h-11 items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2 text-sm">
                <input type="radio" value="COD" {...form.register("paymentPreference")} />
                <span>
                  <span className="block font-semibold">Cash on delivery</span>
                  {quote.data && preference === "COD" && quote.data.amountDueNow > 0 ? (
                    <span className="text-xs text-zinc-500">
                      Pay {formatStorePrice(quote.data.amountDueNow)} now and {formatStorePrice(quote.data.amountOnDelivery)} when delivered.
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-500">Pay the full amount on delivery.</span>
                  )}
                </span>
              </label>
            ) : null}
          </div>
          {quote.data && preference === "COD" && quote.data.amountDueNow > 0 ? (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Pay {formatStorePrice(quote.data.amountDueNow)} to the merchant before dispatch and {formatStorePrice(quote.data.amountOnDelivery)} on delivery.
            </p>
          ) : null}
        </fieldset>
      ) : (
        <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-700">These products cannot be ordered together. Remove prepaid-only or COD-only items.</p>
      )}
      {error ? (
        <div role="alert" className="rounded-2xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      <Button type="submit" className="h-12 w-full rounded-2xl" disabled={submitting || !cart.length || (!prepaid && !cod)}>
        {submitting ? "Submitting order…" : "Submit order"}
      </Button>
    </form>
  );
}
