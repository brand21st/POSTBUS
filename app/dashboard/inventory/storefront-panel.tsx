"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { StorefrontFooterForm } from "@/app/dashboard/inventory/storefront-footer-form";
import { StoreApp } from "@/components/storefront/store-app";
import type { StorePayload } from "@/components/storefront/store-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/hooks/use-api";
import { optimizeImageFile } from "@/lib/images/optimize-client";
import { assembleStoreFooter, DEFAULT_FOOTER_CONFIG, type StorefrontFooterConfig } from "@/modules/storefront/footer";
import type { Paginated, ProductRecord } from "@/types/api";

type Storefront = {
  storeName: string;
  logoUrl: string | null;
  accentColor: string;
  seoTitle: string | null;
  seoDescription: string | null;
  published: boolean;
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

export function InventoryStorefront({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["inventory-storefront"],
    queryFn: () => api<Storefront>("/api/v1/inventory/storefront"),
  });
  const settings = query.data;
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [accentDraft, setAccentDraft] = useState<string | null>(null);
  const [footerDraft, setFooterDraft] = useState<StorefrontFooterConfig | null>(null);
  const [previewMode, setPreviewMode] = useState<"iphone" | "android" | "desktop">("iphone");
  const storeName = nameDraft ?? settings?.storeName ?? "";
  const accentColor = accentDraft ?? settings?.accentColor ?? "#E11D48";

  const categories = useQuery({
    queryKey: ["product-categories"],
    queryFn: () => api<Category[]>("/api/v1/inventory/categories"),
  });
  const products = useQuery({
    queryKey: ["products", "storefront-preview"],
    queryFn: () =>
      api<Paginated<ProductRecord>>("/api/v1/products?page=1&pageSize=100&active=true&storeVisible=true"),
  });

  const save = useMutation({
    mutationFn: (patch: Partial<Storefront>) =>
      api<Storefront>("/api/v1/inventory/storefront", { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: (data) => {
      queryClient.setQueryData(["inventory-storefront"], data);
      toast.success("Storefront saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function upload(kind: "logo" | "slide", file: File | undefined) {
    if (!file) return;
    const optimized = await optimizeImageFile(
      file,
      kind === "logo" ? { maxWidth: 512, maxHeight: 512 } : { maxWidth: 1920, maxHeight: 1350 }
    );
    const body = new FormData();
    body.append("image", optimized);
    const path = kind === "logo" ? "/api/v1/inventory/storefront/logo" : "/api/v1/inventory/storefront/slides";
    try {
      const next = await api<Storefront>(path, { method: "POST", body });
      queryClient.setQueryData(["inventory-storefront"], next);
      toast.success(kind === "logo" ? "Logo uploaded." : "Cover slide added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    }
  }

  async function patchSlide(id: string, patch: Record<string, unknown>) {
    const next = await api<Storefront>(`/api/v1/inventory/storefront/slides/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    queryClient.setQueryData(["inventory-storefront"], next);
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
      storeName: storeName || settings.storeName,
      logoUrl: settings.logoUrl,
      accentColor: accentColor || settings.accentColor,
      seoTitle: settings.seoTitle,
      seoDescription: settings.seoDescription,
      slides: settings.slides.filter((slide) => slide.enabled),
      categories: activeCategories,
      featuredProductIds: settings.featuredProductIds ?? [],
      products: {
        items,
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
  }, [accentColor, categories.data, footerDraft, products.data, settings, storeName]);

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
    <div className="grid w-full min-w-0 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="min-w-0 w-full space-y-4">
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
              checked={settings.published}
              disabled={!canWrite}
              onCheckedChange={(published) => save.mutate({ published })}
            />
          </div>
          {canWrite ? (
            <div className="mt-3">
              <Label>Logo</Label>
              <Input className="mt-1 min-w-0 max-w-full" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void upload("logo", event.target.files?.[0])} />
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">SEO and sharing</h3>
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
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">Store link</h3>
          <p className="mt-1 break-all text-sm text-brand">{settings.storeUrl}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(settings.storeUrl);
                toast.success("Store link copied.");
              }}
            >
              Copy link
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => window.open(settings.storeUrl, "_blank", "noreferrer")}
            >
              Open store
            </Button>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">Featured products</h3>
          <div className="mt-3 max-h-56 space-y-1 overflow-y-auto">
            {(products.data?.items ?? []).map((product) => {
              const selected = (settings.featuredProductIds ?? []).includes(product.id);
              return (
                <label key={product.id} className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm hover:bg-surface-soft">
                  <input
                    type="checkbox"
                    disabled={!canWrite}
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

        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Hero / cover</h3>
              <p className="mt-1 text-xs text-muted">Recommended 1920 × 800 px (desktop) or 1080 × 1350 px (mobile) · WebP/JPG/PNG · max 5 MB</p>
            </div>
            {canWrite ? (
              <Input className="max-w-56" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void upload("slide", event.target.files?.[0])} />
            ) : null}
          </div>
          <div className="mt-3 space-y-3">
            {settings.slides.map((slide, index) => (
              <div key={slide.id} className="rounded-2xl border border-border p-3">
                <div className="flex gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={slide.imageUrl} alt="" className="h-16 w-24 rounded-md object-cover" />
                  <div className="grid flex-1 gap-2">
                    <Input value={slide.title ?? ""} placeholder="Title" onChange={(event) => updateSlidePreview(slide.id, { title: event.target.value })} onBlur={(event) => void patchSlide(slide.id, { title: event.target.value })} />
                    <Input value={slide.subtitle ?? ""} placeholder="Subtitle" onChange={(event) => updateSlidePreview(slide.id, { subtitle: event.target.value })} onBlur={(event) => void patchSlide(slide.id, { subtitle: event.target.value })} />
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={slide.ctaLabel ?? ""} placeholder="CTA label" onChange={(event) => updateSlidePreview(slide.id, { ctaLabel: event.target.value })} onBlur={(event) => void patchSlide(slide.id, { ctaLabel: event.target.value })} />
                      <Input value={slide.ctaHref ?? ""} placeholder="Destination URL" onChange={(event) => updateSlidePreview(slide.id, { ctaHref: event.target.value })} onBlur={(event) => void patchSlide(slide.id, { ctaHref: event.target.value })} />
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <Switch checked={slide.enabled} onCheckedChange={(enabled) => void patchSlide(slide.id, { enabled })} />
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => void patchSlide(slide.id, { sortOrder: index - 1 })}>Up</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => void patchSlide(slide.id, { sortOrder: index + 1 })}>Down</Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        api<Storefront>(`/api/v1/inventory/storefront/slides/${slide.id}/duplicate`, { method: "POST" })
                          .then((next) => queryClient.setQueryData(["inventory-storefront"], next))
                          .catch((error: Error) => toast.error(error.message))
                      }
                    >
                      Duplicate
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        api(`/api/v1/inventory/storefront/slides/${slide.id}`, { method: "DELETE" }).then((next) =>
                          queryClient.setQueryData(["inventory-storefront"], next)
                        )
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
        <StorefrontFooterForm
          value={footerDraft ?? settings.footer ?? DEFAULT_FOOTER_CONFIG}
          disabled={!canWrite}
          onChange={setFooterDraft}
          onCommit={(next) => {
            setFooterDraft(next);
            save.mutate({ footer: next });
          }}
        />
      </div>

      <aside className="order-first min-w-0 w-full lg:order-none lg:sticky lg:top-4 lg:self-start">
        <div>
          <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Live storefront preview</p>
              <p className="text-xs text-muted">
                {previewMode === "iphone" ? "390 × 844" : previewMode === "android" ? "412 × 915" : "Responsive desktop"}
              </p>
            </div>
            <div className="flex min-w-0 rounded-xl border border-border bg-surface-soft p-1">
              {(["iphone", "android", "desktop"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`h-8 min-w-0 flex-1 rounded-lg px-2 text-xs font-medium sm:flex-none sm:px-3 ${previewMode === mode ? "bg-card text-ink shadow-sm" : "text-muted"}`}
                  onClick={() => setPreviewMode(mode)}
                >
                  {mode === "iphone" ? "iPhone" : mode === "android" ? "Android" : "Desktop"}
                </button>
              ))}
            </div>
          </div>
          <div
            className={`max-w-full overflow-hidden bg-white shadow-xl ${
              previewMode === "desktop"
                ? "w-full rounded-2xl border border-border"
                : `mx-auto w-full border-[10px] border-zinc-900 ${
                    previewMode === "iphone" ? "max-w-[390px] rounded-[2.75rem]" : "max-w-[412px] rounded-[2rem]"
                  }`
            }`}
          >
            {previewMode !== "desktop" ? <div className="mx-auto my-2 h-5 w-24 rounded-full bg-zinc-900" aria-hidden /> : null}
            <div
              className={
                previewMode === "iphone"
                  ? "h-[28rem] overflow-auto sm:h-[36rem] lg:h-[40rem]"
                  : previewMode === "android"
                    ? "h-[30rem] overflow-auto sm:h-[38rem] lg:h-[42rem]"
                    : "h-[28rem] overflow-auto sm:h-[36rem] lg:h-[40rem]"
              }
            >
              <StoreApp preview={preview} workspace={settings.workspace} />
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
