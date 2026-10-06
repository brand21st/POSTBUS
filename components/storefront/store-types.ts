import type { StoreFooter } from "@/modules/storefront/footer";

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
  title: string | null;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaHref?: string | null;
};

export type StorePayload = {
  published: boolean;
  storeName: string;
  logoUrl: string | null;
  accentColor: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  slides: StoreSlide[];
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
};
