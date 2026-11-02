"use client";

import { memo, useDeferredValue, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, Loader2, Monitor, Smartphone, Trash2 } from "lucide-react";
import styles from "./inventory.module.css";
import { MarketplaceSettings, MarketplaceBundles } from "./marketplace-settings";
import { DEFAULT_STORE_THEME, DEFAULT_STORE_TRACKING, type StoreTheme, type StoreTrackingConfig } from "@/modules/storefront/config";
import { allocateBundlePrices, type BundleInput } from "@/modules/storefront/bundle-pricing";
import { useMe } from "@/lib/hooks/use-me";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { StorefrontFooterForm } from "@/app/dashboard/inventory/storefront-footer-form";
import type { StorePayload } from "@/components/storefront/store-types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";
import { optimizeImageFile } from "@/lib/images/optimize-client";
import { assembleStoreFooter, DEFAULT_FOOTER_CONFIG, type StorefrontFooterConfig } from "@/modules/storefront/footer";
import type { Paginated, ProductRecord } from "@/types/api";

type Storefront = {
  theme?: StoreTheme;
  tracking?: StoreTrackingConfig;
  storeName: string;
  logoUrl: string | null;
  accentColor: string;
  seoTitle: string | null;
  seoDescription: string | null;
  published: boolean;
  coverAutoplay?: boolean;
  storeUrl: string;
  featuredProductIds: string[];
  slides: Array<{
    id: string;
    imageUrl: string;
    title: string | null;
    subtitle: string | null;
    ctaLabel: string | null;
    ctaHref: string | null;
    enabled: boolean;
  }>;
  workspace: string;
  footer: StorefrontFooterConfig;
  footerPreview: StorePayload["footer"];
  upiId?: string | null;
  gpayNumber?: string | null;
  qrImageUrl?: string | null;
  footerSources: {
    organization: {
      name?: string | null;
      phone?: string | null;
      line1?: string | null;
      line2?: string | null;
      city?: string | null;
      state?: string | null;
      pincode?: string | null;
    } | null;
    email: string | null;
    payments: { prepaid: boolean; cod: boolean; partial: boolean };
    policies: {
      privacyPolicyBody: string;
      privacyPolicyEnabled: boolean;
      termsBody: string;
      termsEnabled: boolean;
      shippingPolicyBody: string;
      shippingPolicyEnabled: boolean;
      returnsBody: string;
      returnsEnabled: boolean;
    };
  };
};

type Category = { id: string; name: string; slug: string; active: boolean; imageUrl?: string | null; description?: string | null };

const StoreApp = memo(dynamic(() => import("@/components/storefront/store-app").then((m) => m.StoreApp), {
  loading: () => <div role="status" className="p-6 text-sm text-muted">Loading preview...</div>,
}));

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
  const [footerDraft, setFooterDraft] = useState<StorefrontFooterConfig | null>(null);
  const [previewMode, setPreviewMode] = useState<"iphone" | "android" | "desktop">("iphone");
  const storeName = nameDraft ?? settings?.storeName ?? "";
  const accentColor = accentDraft ?? settings?.accentColor ?? "#E11D48";
  const published = publishedDraft ?? settings?.published ?? true;

  const categories = useQuery({
    queryKey: ["product-categories"],
    queryFn: () => api<Category[]>("/api/v1/inventory/categories"),
  });
  const products = useQuery({
    queryKey: ["products", "storefront-preview"],
    queryFn: () =>
      api<Paginated<ProductRecord>>("/api/v1/products?page=1&pageSize=100&active=true&storeVisible=true"),
  });
  const bundleRows = useQuery({
    queryKey: ["inventory-bundles"],
    retry: false,
    queryFn: () => api<Array<BundleInput & { id: string }>>("/api/v1/inventory/bundles"),
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

  async function upload(kind: "logo" | "slide" | "qr", file: File | undefined) {
    if (!file || uploading) return;
    setUploading(true);
    try {
      const optimized = await optimizeImageFile(
        file,
        kind === "logo" ? { maxWidth: 512, maxHeight: 512 } : { maxWidth: 1920, maxHeight: 1350 }
      );
      const body = new FormData();
      body.append("image", optimized);
      const path =
        kind === "logo"
          ? "/api/v1/inventory/storefront/logo"
          : kind === "qr"
            ? "/api/v1/inventory/storefront/qr"
            : "/api/v1/inventory/storefront/slides";
      const next = await api<Storefront>(path, { method: "POST", body });
      queryClient.setQueryData(["inventory-storefront"], next);
      toast.success(kind === "logo" ? "Logo uploaded." : kind === "qr" ? "Payment QR uploaded." : "Cover slide added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function patchSlide(id: string, patch: Record<string, unknown>) {
    try {
      const next = await api<Storefront>(`/api/v1/inventory/storefront/slides/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      queryClient.setQueryData(["inventory-storefront"], next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save slide.");
      void queryClient.invalidateQueries({ queryKey: ["inventory-storefront"] });
    }
  }

  function updateSlidePreview(id: string, patch: Record<string, unknown>) {
    queryClient.setQueryData<Storefront>(["inventory-storefront"], (current) =>
      current
        ? {
            ...current,
            slides: current.slides.map((slide) => (slide.id === id ? { ...slide, ...patch } : slide)),
          }
        : current
    );
  }

  const preview = useMemo<StorePayload | null>(() => {
    if (!settings) return null;
    const items = (products.data?.items ?? []).map((product) => ({
      id: product.id,
      slug: product.publicSlug ?? undefined,
      name: product.name,
      sku: product.sku,
      description: product.description ?? null,
      price: product.price,
      compareAtPrice: product.compareAtPrice ?? null,
      discountPercent:
        product.compareAtPrice && product.compareAtPrice > product.price
          ? Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100)
          : null,
      imageUrls: product.imageUrls ?? [],
      onHand: product.onHand,
      inStock: product.onHand > 0,
      prepaidEnabled: product.prepaidEnabled,
      codEnabled: product.codEnabled,
      codAdvancePercent: product.codAdvancePercent,
      returnAvailable: product.returnAvailable !== false,
      lowStockThreshold: product.lowStockThreshold,
      bestSeller: product.bestSeller,
      createdAt: product.createdAt,
      categoryIds: product.categoryIds ?? [],
      upsellIds: product.upsellProductIds ?? [],
      crossSellIds: product.crossSellProductIds ?? [],
    }));
    const activeCategories = (categories.data ?? [])
      .filter((category) => category.active)
      .map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        imageUrl: category.imageUrl,
        description: category.description,
      }));
    const footerConfig = footerDraft ?? settings.footer ?? DEFAULT_FOOTER_CONFIG;
    return {
      published: true,
      marketplace: true,
      theme: themeDraft ?? settings.theme ?? DEFAULT_STORE_THEME,
      tracking: settings.tracking ?? DEFAULT_STORE_TRACKING,
      storeName: storeName || settings.storeName,
      logoUrl: settings.logoUrl,
      accentColor: accentColor || settings.accentColor,
      seoTitle: settings.seoTitle,
      seoDescription: settings.seoDescription,
      slides: settings.slides.filter((slide) => slide.enabled),
      categories: activeCategories,
      featuredProductIds: settings.featuredProductIds ?? [],
      bundles: (bundleRows.data ?? []).flatMap((bundle) => {
        if (!bundle.published) return [];
        const components = bundle.items.flatMap((item) => {
          const product = items.find((candidate) => candidate.id === item.productId);
          return product ? [{ product, quantity: item.quantity }] : [];
        });
        if (components.length !== bundle.items.length || components.length < 2) return [];
        try {
          const pricing = allocateBundlePrices(components.map((item) => ({ productId: item.product.id, price: item.product.price, quantity: item.quantity })), bundle.pricingMode, bundle.priceValue);
          return [{ id: bundle.id, name: bundle.name, pricingMode: bundle.pricingMode, priceValue: bundle.priceValue, components, ...pricing }];
        } catch {
          return [];
        }
      }),
      products: {
        items,
        featured: items.filter((item) => (settings.featuredProductIds ?? []).includes(item.id)),
        bestSellers: items.filter((item) => item.bestSeller && !(settings.featuredProductIds ?? []).includes(item.id)),
        page: 1,
        pageSize: 100,
        total: products.data?.total ?? 0,
      },
      workspace: settings.workspace,
      footer: assembleStoreFooter(footerConfig, {
        storeName: storeName || settings.storeName,
        logoUrl: settings.logoUrl,
        tagline: settings.seoDescription,
        accentColor: accentColor || settings.accentColor,
        workspace: settings.workspace,
        organization: settings.footerSources?.organization ?? null,
        email: settings.footerSources?.email ?? null,
        policies: settings.footerSources?.policies ?? {
          privacyPolicyBody: "",
          privacyPolicyEnabled: false,
          termsBody: "",
          termsEnabled: false,
          shippingPolicyBody: "",
          shippingPolicyEnabled: false,
          returnsBody: "",
          returnsEnabled: false,
        },
        categories: activeCategories,
        hasProducts: items.length > 0,
        hasBestSellers: items.some((item) => item.bestSeller),
        payments: settings.footerSources?.payments ?? {
          prepaid: items.some((item) => item.prepaidEnabled),
          cod: items.some((item) => item.codEnabled),
          partial: items.some((item) => item.codEnabled && Number(item.codAdvancePercent ?? 0) > 0),
        },
      }),
    };
  }, [accentColor, bundleRows.data, categories.data, footerDraft, products.data, settings, storeName, themeDraft]);
  const deferredPreview = useDeferredValue(preview);

  if (query.isError) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="font-semibold">Something went wrong.</p>
        <Button className="mt-3" type="button" onClick={() => void query.refetch()}>Retry</Button>
      </div>
    );
  }

  if (!settings || !preview) return <p className="text-sm text-muted">Loading storefront…</p>;

  return (
    <div className="w-full min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-semibold">{storeName || "Storefront"}</h2>
          <span className={cn("rounded px-2 py-0.5 text-[11px] font-medium", published ? "bg-emerald-500/10 text-emerald-600" : "bg-zinc-500/10 text-muted")}>{published ? "Live" : "Unpublished"}</span>
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
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <Label htmlFor="store-name">Store name</Label>
              <Input
                id="store-name"
                className="mt-1 h-11 min-w-0"
                value={storeName}
                disabled={!canWrite}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={(event) => save.mutate({ storeName: event.target.value })}
              />
            </div>
            <div className="min-w-0">
              <Label htmlFor="store-accent">Accent color</Label>
              <Input
                id="store-accent"
                type="color"
                className="mt-1 h-11 min-w-0"
                value={accentColor}
                disabled={!canWrite}
                onChange={(event) => setAccentDraft(event.target.value)}
                onBlur={(event) => save.mutate({ accentColor: event.target.value })}
              />
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
          {canWrite ? (
            <div className="mt-3">
              <Label>Logo</Label>
              <Input aria-label="Upload store logo" disabled={uploading} className="mt-1 min-w-0 max-w-full" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void upload("logo", event.target.files?.[0])} />
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
                onBlur={(event) => save.mutate({ upiId: event.target.value })}
              />
            </div>
            <div className="min-w-0">
              <Label htmlFor="store-gpay">GPay number</Label>
              <Input
                id="store-gpay"
                className="mt-1 h-11 min-w-0"
                defaultValue={settings.gpayNumber ?? ""}
                disabled={!canWrite}
                placeholder="98XXXXXXXX"
                onBlur={(event) => save.mutate({ gpayNumber: event.target.value })}
              />
            </div>
          </div>
          {canWrite ? (
            <div className="mt-3">
              <Label>UPI / GPay QR</Label>
              <Input
                className="mt-1 min-w-0 max-w-full"
                type="file"
                aria-label="Upload payment QR"
                disabled={uploading}
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => void upload("qr", event.target.files?.[0])}
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
                onBlur={(event) => save.mutate({ seoTitle: event.target.value })}
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
                onBlur={(event) => save.mutate({ seoDescription: event.target.value })}
              />
            </div>
          </div>
        </details>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">Featured products</h3>
          <Input className="mt-3" aria-label="Search featured products" placeholder="Search products" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} />
          {products.isError ? <Button size="xs" variant="ghost" onClick={() => void products.refetch()}>Retry products</Button> : null}
          {products.isPending ? <p role="status" className="mt-2 text-xs text-muted">Loading products...</p> : null}
          {products.isSuccess && !products.data.items.some((product) => `${product.name} ${product.sku}`.toLowerCase().includes(productSearch.toLowerCase())) ? <p className="mt-2 text-xs text-muted">{productSearch ? "No matching products." : "No products available."}</p> : null}
          <div className="mt-3 max-h-56 space-y-1 overflow-y-auto">
            {(products.data?.items ?? []).filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(productSearch.toLowerCase())).map((product) => {
              const selected = (settings.featuredProductIds ?? []).includes(product.id);
              return (
                <label key={product.id} className="flex min-h-9 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-surface-soft">
                  <input
                    type="checkbox"
                    disabled={!canWrite || save.isPending}
                    checked={selected}
                    onChange={(event) => {
                      const current = new Set(settings.featuredProductIds ?? []);
                      if (event.target.checked) current.add(product.id);
                      else current.delete(product.id);
                      save.mutate({ featuredProductIds: [...current] });
                    }}
                  />
                  <span className="truncate">{product.name}</span>
                </label>
              );
            })}
          </div>
        </section>

        <fieldset disabled={!canWrite || uploading}>
        <section className="border-b border-border py-4">
          <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-semibold">Hero / cover</h3>
              <p className="mt-1 text-xs text-muted">Manage covers in the Covers tab — AI studio, mobile crops, scheduling, and analytics.</p>
            </div>
            <a href="/dashboard/inventory?tab=covers" className={buttonVariants({ size: "xs", variant: "secondary" })}>
              Open Cover Studio
            </a>
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={Boolean((settings as { coverAutoplay?: boolean }).coverAutoplay)}
                disabled={!canWrite}
                onCheckedChange={(coverAutoplay) => save.mutate({ coverAutoplay })}
                aria-label="Autoplay covers"
              />
              Autoplay homepage covers (pauses on hover, respects reduced motion)
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {settings.slides.map((slide) => (
              <a key={slide.id} href={`/dashboard/inventory/covers/${slide.id}`} className="overflow-hidden rounded-lg border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={slide.imageUrl} alt={slide.title ?? "Cover"} className="h-14 w-20 object-cover" />
              </a>
            ))}
          </div>
        </section>
        </fieldset>
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
        <div className={styles.preview}>
          <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold">Preview</p>
              <p className="text-xs text-muted">
                {previewMode === "iphone" ? "390 × 844" : previewMode === "android" ? "412 × 915" : "Responsive desktop"}
              </p>
            </div>
            <div className="flex min-w-0 rounded-xl border border-border bg-surface-soft p-1">
              {(["iphone", "android", "desktop"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={previewMode === mode}
                  title={mode === "desktop" ? "Desktop preview" : `${mode} preview`}
                  className={`inline-flex h-8 min-w-0 flex-1 items-center gap-1 rounded-md px-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand ${previewMode === mode ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                  onClick={() => setPreviewMode(mode)}
                >
                  {mode === "desktop" ? <Monitor className="size-3.5" /> : <Smartphone className="size-3.5" />}{mode === "iphone" ? "iPhone" : mode === "android" ? "Android" : "Desktop"}
                </button>
              ))}
            </div>
          </div>
          <div
            className={cn(
              "max-w-full overflow-hidden bg-white shadow-sm transition-[filter] duration-200 motion-reduce:transition-none",
              published ? "grayscale-0" : "grayscale",
              previewMode === "desktop"
                ? "w-full rounded-lg border border-border"
                : cn(
                    "mx-auto w-full border-[10px] border-zinc-900",
                    previewMode === "iphone" ? "max-w-[390px] rounded-[2.75rem]" : "max-w-[412px] rounded-[2rem]"
                  )
            )}
          >
            {previewMode !== "desktop" ? <div className="mx-auto my-2 h-5 w-24 rounded-full bg-zinc-900" aria-hidden /> : null}
            <div
              className="h-[min(65vh,640px)] min-h-80 overflow-auto overscroll-contain"
            >
              <StoreApp preview={deferredPreview} workspace={settings.workspace} />
            </div>
          </div>
        </div>
      </aside>
    </div>
    </div>
  );
}
