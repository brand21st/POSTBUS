import type { StoreFooter } from "@/modules/storefront/footer";
import type { StoreTheme, StoreTrackingConfig } from "@/modules/storefront/config";

export type { StoreFooter };
export type StoreProduct = {
  id: string;
  slug?: string;
  name: string;
  sku: string;
  description: string | null;
  price: number;
  compareAtPrice: number | null;
  discountPercent: number | null;
  weightGrams?: number;
  imageUrls: string[];
  onHand: number;
  inStock: boolean;
  prepaidEnabled: boolean;
  codEnabled: boolean;
  codAdvancePercent?: number;
  returnAvailable?: boolean;
  lowStockThreshold?: number;
  bestSeller?: boolean;
  createdAt?: string;
  categoryIds?: string[];
  upsellIds?: string[];
  crossSellIds?: string[];
};

export type StoreCategory = {
  id: string;
  name: string;
  slug: string;
  imageUrl?: string | null;
  description?: string | null;
};

export type StoreSlide = {
  id: string;
  imageUrl: string;
  mobileImageUrl?: string | null;
  title: string | null;
  subtitle: string | null;
  hook?: string | null;
  ctaLabel: string | null;
  ctaHref?: string | null;
  offerBadge?: string | null;
  textPosition?: "left" | "center" | "right";
  overlayStrength?: number;
  textColor?: string;
  desktopFocal?: { x: number; y: number };
  mobileFocal?: { x: number; y: number };
};

export type StorePayload = {
  marketplace?: boolean;
  theme?: StoreTheme;
  tracking?: StoreTrackingConfig;
  bundles?: StoreBundle[];
  published: boolean;
  storeName: string;
  logoUrl: string | null;
  accentColor: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  slides: StoreSlide[];
  coverAutoplay?: boolean;
  categories: StoreCategory[];
  featuredProductIds: string[];
  products: {
    items: StoreProduct[];
    page: number;
    pageSize: number;
    total: number;
    related?: StoreProduct[];
    bestSellers?: StoreProduct[];
    featured?: StoreProduct[];
  };
  workspace: string;
  footer?: StoreFooter | null;
};

export type CartLine = {
  product: StoreProduct;
  quantity: number;
  bundle?: StoreBundle;
};

export type StoreBundle = {
  id: string; name: string; pricingMode: "FIXED" | "PERCENT"; priceValue: number;
  total: number; subtotal: number; savings: number;
  components: Array<{ product: StoreProduct; quantity: number }>;
};
