"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, EyeOff, Loader2, Monitor, RotateCcw, Smartphone } from "lucide-react";
import styles from "./inventory.module.css";
import { MarketplaceSettings, MarketplaceBundles } from "./marketplace-settings";
import { StoreAddressField, useDebounced } from "./store-address-field";
import { DEFAULT_STORE_THEME, DEFAULT_STORE_TRACKING, type StoreTheme } from "@/modules/storefront/config";
import { coverLifecycle } from "@/modules/storefront/cover-model";
import {
  buildStorefrontPreview,
  STORE_PREVIEW_MESSAGE,
  STORE_PREVIEW_PAGE_SIZE,
  STORE_PREVIEW_READY,
  type PreviewBundle,
  type PreviewCategory,
  type StorefrontPreviewSettings,
} from "@/modules/storefront/preview";
import { useMe } from "@/lib/hooks/use-me";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { StorefrontFooterForm } from "@/app/(site)/dashboard/inventory/storefront-footer-form";
import type { StorePayload } from "@/components/storefront/store-types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";
import { optimizeImageFile } from "@/lib/images/optimize-client";
import { DEFAULT_FOOTER_CONFIG, type StorefrontFooterConfig } from "@/modules/storefront/footer";
import type { Paginated, ProductRecord } from "@/types/api";

type Storefront = StorefrontPreviewSettings & {
  published: boolean;
  storeUrl: string;
  footerPreview: StorePayload["footer"];
  upiId?: string | null;
  gpayNumber?: string | null;
  qrImageUrl?: string | null;
};

type PreviewMode = "iphone" | "android" | "desktop";

/** Mirrors storefrontSettingsSchema.featuredProductIds.max. */
const MAX_FEATURED = 24;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const LIFE_LABEL = { live: "Live", scheduled: "Scheduled", draft: "Draft", expired: "Expired", archived: "Archived" } as const;
const PREVIEW_MODES: Record<PreviewMode, { label: string; size: string; frame: string; height: string }> = {
  iphone: { label: "iPhone", size: "390 × 844", frame: "w-[410px] rounded-[2.75rem] border-[10px] border-zinc-900", height: "h-[min(72vh,844px)]" },
  android: { label: "Android", size: "412 × 915", frame: "w-[432px] rounded-[2rem] border-[10px] border-zinc-900", height: "h-[min(72vh,915px)]" },
  desktop: { label: "Desktop", size: "Full width", frame: "w-full rounded-lg border border-border", height: "h-[min(72vh,760px)]" },
};

export function InventoryStorefront({ canWrite }: { canWrite: boolean }) {
  const me = useMe();
  const [themeDraft, setThemeDraft] = useState<StoreTheme | null>(null);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["inventory-storefront"],
    queryFn: () => api<Storefront>("/api/v1/inventory/storefront"),
  });
  const settings = query.data;
  const [uploading, setUploading] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [accentDraft, setAccentDraft] = useState<string | null>(null);
  const [publishedDraft, setPublishedDraft] = useState<boolean | null>(null);
  const [featuredDraft, setFeaturedDraft] = useState<string[] | null>(null);
  const [footerDraft, setFooterDraft] = useState<StorefrontFooterConfig | null>(null);
  const storeName = nameDraft ?? settings?.storeName ?? "";
  const accentColor = accentDraft ?? settings?.accentColor ?? "#E11D48";
  const published = publishedDraft ?? settings?.published ?? true;
  const featuredIds = featuredDraft ?? settings?.featuredProductIds ?? [];

  const categories = useQuery({
    queryKey: ["product-categories"],
    queryFn: () => api<PreviewCategory[]>("/api/v1/inventory/categories"),
  });
  const products = useQuery({
    queryKey: ["products", "storefront-preview"],
    queryFn: () =>
      api<Paginated<ProductRecord>>(`/api/v1/products?page=1&pageSize=${STORE_PREVIEW_PAGE_SIZE}&active=true&storeVisible=true`),
  });
  const searchTerm = useDebounced(productSearch.trim(), 250);
  const productMatches = useQuery({
    queryKey: ["products", "storefront-featured", searchTerm],
    enabled: Boolean(searchTerm),
    queryFn: ({ signal }) =>
      api<Paginated<ProductRecord>>(
        `/api/v1/products?page=1&pageSize=50&active=true&storeVisible=true&q=${encodeURIComponent(searchTerm)}`,
        { signal }
      ),
  });
  const bundleRows = useQuery({
    queryKey: ["inventory-bundles"],
    retry: false,
    queryFn: () => api<PreviewBundle[]>("/api/v1/inventory/bundles"),
  });

  const save = useMutation({
    scope: { id: "storefront-settings" },
    mutationFn: (patch: Partial<Storefront>) => {
      const current = queryClient.getQueryData<Storefront>(["inventory-storefront"]);
      return current && Object.entries(patch).every(([key, value]) => JSON.stringify(current[key as keyof Storefront]) === JSON.stringify(value))
        ? Promise.resolve(current)
        : api<Storefront>("/api/v1/inventory/storefront", { method: "PATCH", body: JSON.stringify(patch) });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["inventory-storefront"], data);
      toast.success("Storefront saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function upload(kind: "logo" | "qr", input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file || uploading) return;
    setUploading(true);
    try {
      const optimized = await optimizeImageFile(file, kind === "logo" ? { maxWidth: 512, maxHeight: 512 } : { maxWidth: 1920, maxHeight: 1350 });
      const body = new FormData();
      body.append("image", optimized);
      const next = await api<Storefront>(`/api/v1/inventory/storefront/${kind}`, { method: "POST", body });
      queryClient.setQueryData(["inventory-storefront"], next);
      toast.success(kind === "logo" ? "Logo uploaded." : "Payment QR uploaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      // Clear the picker so choosing the same file again still uploads.
      input.value = "";
      setUploading(false);
    }
  }

  function saveStoreName(value: string) {
    const next = value.trim();
    if (!settings || next === settings.storeName) {
      setNameDraft(null);
      return;
    }
    save.mutate({ storeName: next }, { onSuccess: () => setNameDraft(null) });
  }

  function saveAccent(value: string) {
    if (!settings) return;
    if (!HEX_COLOR.test(value)) {
      toast.error("Use a hex color like #E11D48.");
      setAccentDraft(null);
      return;
    }
    if (value.toLowerCase() === settings.accentColor.toLowerCase()) {
      setAccentDraft(null);
      return;
    }
    save.mutate({ accentColor: value }, { onSuccess: () => setAccentDraft(null) });
  }

  function toggleFeatured(productId: string, checked: boolean) {
    const next = checked ? [...new Set([...featuredIds, productId])] : featuredIds.filter((id) => id !== productId);
    if (next.length > MAX_FEATURED) {
      toast.error(`You can feature up to ${MAX_FEATURED} products.`);
      return;
    }
    // Keep a local draft so quick successive toggles build on each other instead of on stale server data.
    setFeaturedDraft(next);
    save.mutate(
      { featuredProductIds: next },
      {
        onSuccess: (data) => setFeaturedDraft((draft) => (draft && JSON.stringify(draft) === JSON.stringify(data.featuredProductIds) ? null : draft)),
        onError: () => setFeaturedDraft(null),
      }
    );
  }

  const preview = useMemo<StorePayload | null>(() => {
    if (!settings) return null;
    return buildStorefrontPreview({
      settings,
      products: products.data?.items ?? [],
      productTotal: products.data?.total,
      categories: categories.data ?? [],
      bundles: bundleRows.data ?? [],
      drafts: { storeName, accentColor: HEX_COLOR.test(accentColor) ? accentColor : null, theme: themeDraft, footer: footerDraft },
    });
  }, [accentColor, bundleRows.data, categories.data, footerDraft, products.data, settings, storeName, themeDraft]);
  const deferredPreview = useDeferredValue(preview);

  if (query.isError) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="font-semibold">Could not load storefront settings.</p>
        <p className="mt-1 text-xs text-muted">{query.error instanceof Error ? query.error.message : "Please try again."}</p>
        <Button className="mt-3" type="button" onClick={() => void query.refetch()}>Retry</Button>
      </div>
    );
  }

  if (!settings || !deferredPreview) {
    return (
      <div role="status" aria-label="Loading storefront" className="grid w-full min-w-0 gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
        <Skeleton className="h-[min(72vh,760px)] w-full" />
      </div>
    );
  }

  const searchedProducts = searchTerm ? productMatches.data?.items : products.data?.items;
  const searchPending = searchTerm ? productMatches.isPending : products.isPending;
  const searchFailed = searchTerm ? productMatches.isError : products.isError;
  const covers = settings.slides.filter((slide) => slide.status !== "ARCHIVED");

  return (
    <div className="w-full min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-semibold">{storeName || settings.storeName || "Storefront"}</h2>
          <span className={cn("rounded px-2 py-0.5 text-[11px] font-medium", published ? "bg-emerald-500/10 text-emerald-600" : "bg-zinc-500/10 text-muted")}>{published ? "Live" : "Hidden"}</span>
          <a href={settings.storeUrl} target="_blank" rel="noreferrer" className="hidden truncate text-xs text-muted hover:text-ink hover:underline sm:inline">
            {settings.storeUrl.replace(/^https?:\/\//, "")}
          </a>
        </div>
        <div className="flex items-center gap-2">
          <span role="status" className="flex items-center gap-1 text-xs text-muted">{save.isPending || uploading ? <><Loader2 className="size-3 animate-spin" />Saving</> : save.isError ? "Save failed" : <><Check className="size-3" />Saved</>}</span>
          <Button size="icon-xs" variant="secondary" aria-label="Copy store link" title="Copy store link" onClick={() => void navigator.clipboard.writeText(settings.storeUrl).then(() => toast.success("Store link copied.")).catch(() => toast.error("Could not copy link."))}><Copy /></Button>
          <a href={settings.storeUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-surface-soft">View store<ExternalLink className="size-3.5" /></a>
        </div>
      </div>
    <div className="grid w-full min-w-0 gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className={styles.editor}>
        <MarketplaceSettings theme={themeDraft ?? settings.theme ?? DEFAULT_STORE_THEME} tracking={settings.tracking ?? DEFAULT_STORE_TRACKING} canWrite={canWrite} canTrack={me.data?.role === "OWNER" || me.data?.role === "ADMIN"} onTheme={setThemeDraft} onSave={(patch) => save.mutate(patch)} />
        <MarketplaceBundles canWrite={canWrite} />
        <section className="rounded-2xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">Store settings</h3>
          <div className="mt-3 grid gap-3">
            <div className="min-w-0">
              <Label htmlFor="store-name">Store name</Label>
              <Input
                id="store-name"
                className="mt-1 h-11 min-w-0"
                maxLength={80}
                value={storeName}
                disabled={!canWrite}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={(event) => saveStoreName(event.target.value)}
              />
              <p className="mt-1 text-xs text-muted">Shown in the store header, footer and search results.</p>
            </div>
            <StoreAddressField<Storefront>
              workspace={settings.workspace}
              storeUrl={settings.storeUrl}
              canChange={canWrite && (me.data?.role === "OWNER" || me.data?.role === "ADMIN")}
              onSaved={(next) => queryClient.setQueryData(["inventory-storefront"], next)}
            />
            <div className="min-w-0">
              <Label htmlFor="store-accent-hex">Accent color</Label>
              <div className="mt-1 flex min-w-0 items-center gap-2">
                <Input
                  id="store-accent"
                  aria-label="Pick accent color"
                  type="color"
                  className="h-11 shrink-0"
                  value={HEX_COLOR.test(accentColor) ? accentColor : settings.accentColor}
                  disabled={!canWrite}
                  onChange={(event) => setAccentDraft(event.target.value)}
                  onBlur={(event) => saveAccent(event.target.value)}
                />
                <Input
                  id="store-accent-hex"
                  className="h-11 min-w-0 font-mono uppercase"
                  maxLength={7}
                  value={accentColor}
                  disabled={!canWrite}
                  onChange={(event) => setAccentDraft(event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`)}
                  onBlur={(event) => saveAccent(event.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="mt-3 flex min-h-11 items-center justify-between rounded-xl border border-border px-3">
            <Label htmlFor="store-published">Store visible</Label>
            <Switch
              id="store-published"
              checked={published}
              disabled={!canWrite}
              className="data-[state=checked]:bg-emerald-500 dark:data-[state=checked]:bg-emerald-500"
              onCheckedChange={(next) => {
                setPublishedDraft(next);
                save.mutate(
                  { published: next },
                  {
                    onError: () => setPublishedDraft(null),
                    onSuccess: () => setPublishedDraft(null),
                  }
                );
              }}
            />
          </div>
          {!published ? (
            <p className="mt-2 text-xs text-muted">Customers see “Store temporarily unavailable”. The preview still shows your draft.</p>
          ) : null}
          {canWrite ? (
            <div className="mt-3">
              <Label htmlFor="store-logo">Logo</Label>
              <div className="mt-1 flex min-w-0 items-center gap-2">
                {settings.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={settings.logoUrl} alt="Current logo" className="size-10 shrink-0 rounded-md border border-border object-contain" />
                ) : null}
                <Input id="store-logo" disabled={uploading} className="min-w-0 max-w-full" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void upload("logo", event.currentTarget)} />
              </div>
            </div>
          ) : null}
        </section>

        <details>
          <summary>WhatsApp order payments</summary>
          <p className="mt-1 text-xs text-muted">
            Shown to customers after you process a WhatsApp order that needs advance or prepaid payment. Not used for Postbus SaaS billing.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <Label htmlFor="store-upi">UPI ID</Label>
              <Input
                id="store-upi"
                className="mt-1 h-11 min-w-0"
                defaultValue={settings.upiId ?? ""}
                disabled={!canWrite}
                placeholder="merchant@upi"
                onBlur={(event) => save.mutate({ upiId: event.target.value.trim() || null })}
              />
            </div>
            <div className="min-w-0">
              <Label htmlFor="store-gpay">GPay number</Label>
              <Input
                id="store-gpay"
                className="mt-1 h-11 min-w-0"
                inputMode="tel"
                defaultValue={settings.gpayNumber ?? ""}
                disabled={!canWrite}
                placeholder="98XXXXXXXX"
                onBlur={(event) => save.mutate({ gpayNumber: event.target.value.trim() || null })}
              />
            </div>
          </div>
          {canWrite ? (
            <div className="mt-3">
              <Label htmlFor="store-qr">UPI / GPay QR</Label>
              <Input
                id="store-qr"
                className="mt-1 min-w-0 max-w-full"
                type="file"
                disabled={uploading}
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => void upload("qr", event.currentTarget)}
              />
              {settings.qrImageUrl ? (
                <p className="mt-2 text-xs text-muted">QR uploaded. Customers receive this image with payment instructions.</p>
              ) : null}
            </div>
          ) : null}
        </details>

        <details>
          <summary>SEO and sharing</summary>
          <p className="mt-1 text-xs text-muted">Used for the public store title, search description, and social previews.</p>
          <div className="mt-3 space-y-3">
            <div className="min-w-0">
              <Label htmlFor="store-seo-title">SEO title</Label>
              <Input
                id="store-seo-title"
                className="mt-1 h-11 min-w-0"
                maxLength={70}
                defaultValue={settings.seoTitle ?? ""}
                disabled={!canWrite}
                placeholder={`${storeName} · Shop`}
                onBlur={(event) => save.mutate({ seoTitle: event.target.value.trim() || null })}
              />
            </div>
            <div className="min-w-0">
              <Label htmlFor="store-seo-description">Meta description</Label>
              <Input
                id="store-seo-description"
                className="mt-1 h-11 min-w-0"
                maxLength={180}
                defaultValue={settings.seoDescription ?? ""}
                disabled={!canWrite}
                placeholder={`Browse products and order directly from ${storeName}.`}
                onBlur={(event) => save.mutate({ seoDescription: event.target.value.trim() || null })}
              />
            </div>
          </div>
        </details>

        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Featured products</h3>
            <span className="text-xs text-muted">{featuredIds.length} of {MAX_FEATURED} selected</span>
          </div>
          <Input className="mt-3" type="search" aria-label="Search featured products" placeholder="Search by name or SKU" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} />
          {searchFailed ? (
            <Button size="xs" variant="ghost" onClick={() => void (searchTerm ? productMatches.refetch() : products.refetch())}>Retry products</Button>
          ) : null}
          {searchPending ? <p role="status" className="mt-2 text-xs text-muted">Loading products...</p> : null}
          {searchedProducts && !searchedProducts.length ? (
            <p className="mt-2 text-xs text-muted">{searchTerm ? "No matching products." : "No visible products yet. Products must be active and visible in store."}</p>
          ) : null}
          <div className="mt-3 max-h-56 space-y-1 overflow-y-auto">
            {(searchedProducts ?? []).map((product) => {
              const selected = featuredIds.includes(product.id);
              return (
                <label key={product.id} className="flex min-h-9 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-surface-soft">
                  <input
                    type="checkbox"
                    disabled={!canWrite || (!selected && featuredIds.length >= MAX_FEATURED)}
                    checked={selected}
                    onChange={(event) => toggleFeatured(product.id, event.target.checked)}
                  />
                  <span className="min-w-0 flex-1 truncate">{product.name}</span>
                  <span className="shrink-0 text-[11px] text-muted">{product.sku}</span>
                </label>
              );
            })}
          </div>
        </section>

        <section className="border-b border-border py-4">
          <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-semibold">Hero / cover</h3>
              <p className="mt-1 text-xs text-muted">Manage covers in the Covers tab — AI studio, mobile crops, scheduling, and analytics.</p>
            </div>
            <Link href="/dashboard/inventory?tab=covers" scroll={false} className={buttonVariants({ size: "xs", variant: "secondary" })}>
              Open Cover Studio
            </Link>
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={settings.coverAutoplay === true}
                disabled={!canWrite || uploading}
                onCheckedChange={(coverAutoplay) => save.mutate({ coverAutoplay })}
                aria-label="Autoplay covers"
              />
              Autoplay homepage covers (pauses on hover, respects reduced motion)
            </label>
          </div>
          {covers.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {covers.map((slide) => {
                const life = coverLifecycle(slide);
                return (
                  <Link
                    key={slide.id}
                    href={`/dashboard/inventory/covers/${slide.id}`}
                    title={`${slide.title || slide.name || "Cover"} · ${LIFE_LABEL[life]}`}
                    className="relative overflow-hidden rounded-lg border border-border"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={slide.imageUrl} alt={slide.title ?? "Cover"} className={cn("h-14 w-20 object-cover", life !== "live" && "opacity-60")} />
                    <span
                      className={cn(
                        "absolute bottom-0.5 left-0.5 rounded px-1 text-[9px] font-semibold",
                        life === "live" ? "bg-emerald-50 text-emerald-800" : life === "scheduled" ? "bg-amber-50 text-amber-800" : "bg-zinc-100 text-zinc-700"
                      )}
                    >
                      {LIFE_LABEL[life]}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted">No covers yet. Your store opens straight to the catalog.</p>
          )}
        </section>
        <details>
          <summary>Footer and policies</summary>
        <StorefrontFooterForm
          value={footerDraft ?? settings.footer ?? DEFAULT_FOOTER_CONFIG}
          disabled={!canWrite}
          onChange={setFooterDraft}
          onCommit={(next) => {
            setFooterDraft(next);
            save.mutate({ footer: next });
          }}
        />
        </details>
      </div>

      <aside className="min-w-0 w-full lg:sticky lg:top-4 lg:self-start">
        <StorefrontPreviewPane store={deferredPreview} published={published} />
      </aside>
    </div>
    </div>
  );
}

/**
 * Renders the draft store in a same-origin iframe so device widths, media queries, fixed sheets,
 * scroll locks and store fonts behave as they do on the live store without leaking into the dashboard.
 */
function StorefrontPreviewPane({ store, published }: { store: StorePayload; published: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(store);
  const [mode, setMode] = useState<PreviewMode>("iphone");
  const [ready, setReady] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const device = PREVIEW_MODES[mode];

  useEffect(() => {
    latest.current = store;
    if (ready) frame.current?.contentWindow?.postMessage({ type: STORE_PREVIEW_MESSAGE, store }, window.location.origin);
  }, [ready, store]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if ((event.data as { type?: unknown } | null)?.type !== STORE_PREVIEW_READY) return;
      setReady(true);
      frame.current?.contentWindow?.postMessage({ type: STORE_PREVIEW_MESSAGE, store: latest.current }, window.location.origin);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className={styles.preview}>
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">Preview</p>
          <p className="text-xs text-muted">{device.size} · orders can’t be placed from the preview</p>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Preview device" className="flex min-w-0 rounded-xl border border-border bg-surface-soft p-1">
            {(Object.keys(PREVIEW_MODES) as PreviewMode[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={mode === key}
                title={`${PREVIEW_MODES[key].label} preview`}
                className={`inline-flex h-8 min-w-0 flex-1 items-center gap-1 rounded-md px-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand ${mode === key ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                onClick={() => setMode(key)}
              >
                {key === "desktop" ? <Monitor className="size-3.5" /> : <Smartphone className="size-3.5" />}{PREVIEW_MODES[key].label}
              </button>
            ))}
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Restart preview"
            title="Restart preview (clears the preview cart and search)"
            onClick={() => {
              setReady(false);
              setFrameKey((key) => key + 1);
            }}
          >
            <RotateCcw />
          </Button>
        </div>
      </div>
      {!published ? (
        <p className="mb-2 flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          <EyeOff className="size-3.5 shrink-0" />Store is hidden. Customers can’t open it until you turn on Store visible.
        </p>
      ) : null}
      <div className={cn("relative mx-auto max-w-full overflow-hidden bg-white shadow-sm", device.frame)}>
        <iframe
          key={frameKey}
          ref={frame}
          src="/store-preview"
          title="Storefront preview"
          className={cn("block w-full border-0 bg-white", device.height)}
        />
        {!ready ? (
          <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-white text-xs text-zinc-500">
            <Loader2 className="size-4 animate-spin" />Loading preview...
          </div>
        ) : null}
      </div>
    </div>
  );
}
