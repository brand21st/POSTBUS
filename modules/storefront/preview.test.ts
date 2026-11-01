import { describe, expect, it } from "vitest";
import type { CoverRecord } from "@/modules/storefront/cover-model";
import { DEFAULT_FOOTER_CONFIG } from "@/modules/storefront/footer";
import {
  buildStorefrontPreview,
  isStorePreviewMessage,
  previewProduct,
  STORE_PREVIEW_MESSAGE,
  type StorefrontPreviewSettings,
} from "@/modules/storefront/preview";
import type { ProductRecord } from "@/types/api";

const NOW = new Date("2026-10-26T10:00:00.000Z");

function cover(id: string, patch: Partial<CoverRecord> = {}): CoverRecord {
  return {
    id, name: null, imageUrl: `https://cdn.example/${id}.jpg`, imagePath: `${id}.jpg`, mobileImageUrl: null, mobileImagePath: null,
    title: id, subtitle: null, hook: null, description: null, ctaLabel: null, ctaHref: null, offerBadge: null, discountPercent: null,
    coverType: "homepage_hero", status: "PUBLISHED", textPosition: "left", overlayStrength: 40, textColor: "#ffffff",
    desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 50, y: 50 }, luminance: null, startsAt: null, endsAt: null,
    sourceAssetId: null, aiAssetId: null, festival: null, preset: null, sortOrder: 0, enabled: true, ...patch,
  };
}

function product(id: string, patch: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id, name: id, sku: id.toUpperCase(), price: 100, weightGrams: 200, active: true, prepaidEnabled: true, codEnabled: true,
    codAdvancePercent: 0, onHand: 5, reserved: 0, ...patch,
  };
}

function settings(patch: Partial<StorefrontPreviewSettings> = {}): StorefrontPreviewSettings {
  return {
    storeName: "Samanga", logoUrl: null, accentColor: "#E11D48", seoTitle: null, seoDescription: null,
    featuredProductIds: [], slides: [], workspace: "samanga", footer: DEFAULT_FOOTER_CONFIG, ...patch,
  };
}

describe("storefront preview payload", () => {
  it("shows only the covers the live store would show, in display order", () => {
    const store = buildStorefrontPreview({
      settings: settings({
        slides: [
          cover("archived", { status: "ARCHIVED", sortOrder: 0 }),
          cover("second", { sortOrder: 2 }),
          cover("draft", { status: "DRAFT", sortOrder: 1 }),
          cover("disabled", { enabled: false }),
          cover("scheduled", { startsAt: "2026-11-01T00:00:00.000Z" }),
          cover("expired", { endsAt: "2026-10-01T00:00:00.000Z" }),
          cover("first", { sortOrder: 1 }),
        ],
      }),
      products: [],
      categories: [],
      bundles: [],
      now: NOW,
    });
    expect(store.slides.map((slide) => slide.id)).toEqual(["first", "second"]);
  });

  it("applies unsaved drafts and falls back to saved values when a draft is blank", () => {
    const theme = { version: 1 as const, secondaryColor: "#0f766e", font: "manrope" as const };
    const store = buildStorefrontPreview({
      settings: settings(),
      products: [],
      categories: [],
      bundles: [],
      drafts: { storeName: "  ", accentColor: "#1d4ed8", theme, footer: { ...DEFAULT_FOOTER_CONFIG, enabled: false } },
    });
    expect(store.storeName).toBe("Samanga");
    expect(store.accentColor).toBe("#1d4ed8");
    expect(store.theme).toEqual(theme);
    expect(store.footer).toBeNull();
  });

  it("keeps the live store layout and autoplay setting", () => {
    const store = buildStorefrontPreview({
      settings: settings({ marketplace: false, coverAutoplay: true }),
      products: [],
      categories: [],
      bundles: [],
    });
    expect(store.marketplace).toBe(false);
    expect(store.coverAutoplay).toBe(true);
    expect(store.published).toBe(true);
  });

  it("drops compare-at prices that are not above the price, like the public catalog", () => {
    expect(previewProduct(product("a", { price: 500, compareAtPrice: 400 }))).toMatchObject({ compareAtPrice: null, discountPercent: null });
    expect(previewProduct(product("b", { price: 750, compareAtPrice: 1000 }))).toMatchObject({ compareAtPrice: 1000, discountPercent: 25 });
    expect(previewProduct(product("c", { onHand: 0 }))).toMatchObject({ inStock: false, returnAvailable: true });
  });

  it("orders featured products as selected and keeps them out of best sellers", () => {
    const store = buildStorefrontPreview({
      settings: settings({ featuredProductIds: ["c", "missing", "a"] }),
      products: [product("a", { bestSeller: true }), product("b", { bestSeller: true }), product("c")],
      categories: [
        { id: "cat-1", name: "Apparel", slug: "apparel", active: true },
        { id: "cat-2", name: "Hidden", slug: "hidden", active: false },
      ],
      bundles: [],
    });
    expect(store.products.featured?.map((item) => item.id)).toEqual(["c", "a"]);
    expect(store.products.bestSellers?.map((item) => item.id)).toEqual(["b"]);
    expect(store.categories.map((category) => category.id)).toEqual(["cat-1"]);
  });

  it("hides bundles the live store would hide", () => {
    const bundle = (id: string, items: Array<{ productId: string; quantity: number }>, published = true) => ({
      id, name: id, pricingMode: "PERCENT" as const, priceValue: 10, published, sortOrder: 0, items,
    });
    const store = buildStorefrontPreview({
      settings: settings(),
      products: [product("a"), product("b"), product("low", { onHand: 1 })],
      categories: [],
      bundles: [
        bundle("ok", [{ productId: "a", quantity: 1 }, { productId: "b", quantity: 2 }]),
        bundle("draft", [{ productId: "a", quantity: 1 }, { productId: "b", quantity: 1 }], false),
        bundle("short-stock", [{ productId: "a", quantity: 1 }, { productId: "low", quantity: 2 }]),
        bundle("not-visible", [{ productId: "a", quantity: 1 }, { productId: "gone", quantity: 1 }]),
      ],
    });
    expect(store.bundles?.map((item) => item.id)).toEqual(["ok"]);
    expect(store.bundles?.[0].total).toBe(270);
  });
});

describe("storefront preview messages", () => {
  it("accepts only well-formed preview payloads", () => {
    const store = buildStorefrontPreview({ settings: settings(), products: [], categories: [], bundles: [] });
    expect(isStorePreviewMessage({ type: STORE_PREVIEW_MESSAGE, store })).toBe(true);
    expect(isStorePreviewMessage({ type: "other", store })).toBe(false);
    expect(isStorePreviewMessage({ type: STORE_PREVIEW_MESSAGE, store: { storeName: "x" } })).toBe(false);
    expect(isStorePreviewMessage(null)).toBe(false);
    expect(isStorePreviewMessage("postbus:store-preview")).toBe(false);
  });
});
