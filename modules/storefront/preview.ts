import type { StoreBundle, StoreCategory, StorePayload, StoreProduct } from "@/components/storefront/store-types";
import { allocateBundlePrices, type BundleInput } from "@/modules/storefront/bundle-pricing";
import { DEFAULT_STORE_THEME, DEFAULT_STORE_TRACKING, type StoreTheme, type StoreTrackingConfig } from "@/modules/storefront/config";
import { eligibleCovers, type CoverRecord } from "@/modules/storefront/cover-model";
import { assembleStoreFooter, DEFAULT_FOOTER_CONFIG, type StoreFooterSources, type StorefrontFooterConfig } from "@/modules/storefront/footer";
import type { ProductRecord } from "@/types/api";

/** Message types exchanged between the dashboard Storefront tab and the framed /store-preview page. */
export const STORE_PREVIEW_MESSAGE = "postbus:store-preview";
export const STORE_PREVIEW_READY = "postbus:store-preview-ready";
export const STORE_PREVIEW_PAGE_SIZE = 100;

export type StorefrontPreviewSettings = {
  theme?: StoreTheme;
  tracking?: StoreTrackingConfig;
  marketplace?: boolean;
  storeName: string;
  logoUrl: string | null;
  accentColor: string;
  seoTitle: string | null;
  seoDescription: string | null;
  coverAutoplay?: boolean;
  featuredProductIds: string[];
  slides: CoverRecord[];
  workspace: string;
  footer: StorefrontFooterConfig;
  footerSources?: {
    organization: StoreFooterSources["organization"];
    email: string | null;
    payments: StoreFooterSources["payments"];
    policies: StoreFooterSources["policies"];
  };
};

export type PreviewCategory = StoreCategory & { active: boolean };
export type PreviewBundle = BundleInput & { id: string };
export type StorefrontPreviewDrafts = {
  storeName?: string | null;
  accentColor?: string | null;
  theme?: StoreTheme | null;
  footer?: StorefrontFooterConfig | null;
};

const NO_POLICIES: StoreFooterSources["policies"] = {
  privacyPolicyBody: "",
  privacyPolicyEnabled: false,
  termsBody: "",
  termsEnabled: false,
  shippingPolicyBody: "",
  shippingPolicyEnabled: false,
  returnsBody: "",
  returnsEnabled: false,
};

/** Mirrors mapPublicProduct so the preview prices and stock badges match the live store. */
export function previewProduct(product: ProductRecord): StoreProduct {
  const compareAtPrice = product.compareAtPrice != null && product.compareAtPrice > product.price ? product.compareAtPrice : null;
  return {
    id: product.id,
    slug: product.publicSlug ?? undefined,
    name: product.name,
    sku: product.sku,
    description: product.description ?? null,
    price: product.price,
    compareAtPrice,
    discountPercent: compareAtPrice ? Math.round(((compareAtPrice - product.price) / compareAtPrice) * 100) : null,
    weightGrams: product.weightGrams,
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
  };
}

/** Same eligibility rules as loadPublicStorefront: every component in stock, 2-8 components. */
function previewBundles(rows: PreviewBundle[], items: StoreProduct[]): StoreBundle[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return rows.flatMap((bundle) => {
    if (!bundle.published) return [];
    const components = bundle.items.map((item) => ({ product: byId.get(item.productId), quantity: item.quantity }));
    if (
      components.length < 2 ||
      components.length > 8 ||
      components.some((item) => !item.product || !item.product.inStock || item.product.onHand < item.quantity)
    ) {
      return [];
    }
    const ready = components as Array<{ product: StoreProduct; quantity: number }>;
    try {
      const pricing = allocateBundlePrices(
        ready.map((item) => ({ productId: item.product.id, price: item.product.price, quantity: item.quantity })),
        bundle.pricingMode,
        bundle.priceValue
      );
      return [{ id: bundle.id, name: bundle.name, pricingMode: bundle.pricingMode, priceValue: bundle.priceValue, components: ready, ...pricing }];
    } catch {
      return [];
    }
  });
}

/**
 * Builds the payload the framed preview renders: saved settings plus unsaved drafts,
 * shaped like the public /api/v1/public/store response.
 */
export function buildStorefrontPreview(input: {
  settings: StorefrontPreviewSettings;
  products: ProductRecord[];
  productTotal?: number;
  categories: PreviewCategory[];
  bundles: PreviewBundle[];
  drafts?: StorefrontPreviewDrafts;
  now?: Date;
}): StorePayload {
  const { settings, drafts = {} } = input;
  const items = input.products.map(previewProduct);
  const featuredIds = settings.featuredProductIds ?? [];
  const featuredSet = new Set(featuredIds);
  const byId = new Map(items.map((item) => [item.id, item]));
  const categories = input.categories
    .filter((category) => category.active)
    .map(({ id, name, slug, imageUrl, description }) => ({ id, name, slug, imageUrl, description }));
  const storeName = drafts.storeName?.trim() || settings.storeName;
  const accentColor = drafts.accentColor || settings.accentColor;
  const footerSources = settings.footerSources;
  return {
    marketplace: settings.marketplace !== false,
    published: true,
    theme: drafts.theme ?? settings.theme ?? DEFAULT_STORE_THEME,
    tracking: settings.tracking ?? DEFAULT_STORE_TRACKING,
    storeName,
    logoUrl: settings.logoUrl,
    accentColor,
    seoTitle: settings.seoTitle,
    seoDescription: settings.seoDescription,
    slides: eligibleCovers(settings.slides ?? [], input.now),
    coverAutoplay: settings.coverAutoplay === true,
    categories,
    featuredProductIds: featuredIds,
    bundles: previewBundles(input.bundles, items),
    products: {
      items,
      featured: featuredIds.flatMap((id) => byId.get(id) ?? []),
      bestSellers: items.filter((item) => item.bestSeller && !featuredSet.has(item.id)),
      page: 1,
      pageSize: STORE_PREVIEW_PAGE_SIZE,
      total: input.productTotal ?? items.length,
    },
    workspace: settings.workspace,
    footer: assembleStoreFooter(drafts.footer ?? settings.footer ?? DEFAULT_FOOTER_CONFIG, {
      storeName,
      logoUrl: settings.logoUrl,
      tagline: settings.seoDescription,
      accentColor,
      workspace: settings.workspace,
      organization: footerSources?.organization ?? null,
      email: footerSources?.email ?? null,
      policies: footerSources?.policies ?? NO_POLICIES,
      categories,
      hasProducts: items.length > 0,
      hasBestSellers: items.some((item) => item.bestSeller),
      payments: footerSources?.payments ?? {
        prepaid: items.some((item) => item.prepaidEnabled),
        cod: items.some((item) => item.codEnabled),
        partial: items.some((item) => item.codEnabled && Number(item.codAdvancePercent ?? 0) > 0),
      },
    }),
  };
}

export function isStorePreviewMessage(data: unknown): data is { type: typeof STORE_PREVIEW_MESSAGE; store: StorePayload } {
  if (!data || typeof data !== "object") return false;
  const message = data as { type?: unknown; store?: unknown };
  if (message.type !== STORE_PREVIEW_MESSAGE || !message.store || typeof message.store !== "object") return false;
  const store = message.store as Partial<StorePayload>;
  return (
    typeof store.storeName === "string" &&
    typeof store.workspace === "string" &&
    Array.isArray(store.slides) &&
    Array.isArray(store.categories) &&
    Boolean(store.products && Array.isArray(store.products.items))
  );
}
