import type { StorePayload, StoreProduct } from "@/components/storefront/store-types";
import { allocateBundlePrices } from "@/modules/storefront/bundle-pricing";
import { DEFAULT_STORE_THEME, DEFAULT_STORE_TRACKING } from "@/modules/storefront/config";

function item(partial: Partial<StoreProduct> & Pick<StoreProduct, "id" | "name" | "price">): StoreProduct {
  return {
    sku: partial.id,
    description: partial.description ?? "A compact product for everyday orders.",
    compareAtPrice: null,
    discountPercent: null,
    imageUrls: [],
    onHand: 8,
    inStock: true,
    prepaidEnabled: true,
    codEnabled: true,
    returnAvailable: true,
    categoryIds: ["home"],
    ...partial,
  };
}

const products: StoreProduct[] = [
  item({ id: "p1", name: "Handloom cotton stole with an extra long display name for wrapping", price: 899, compareAtPrice: 1299, discountPercent: 31, categoryIds: ["apparel"], bestSeller: true, upsellIds: ["p2", "p3"] }),
  item({ id: "p2", name: "Brass diya pair", price: 450, categoryIds: ["home"], crossSellIds: ["p1"] }),
  item({ id: "p3", name: "Spice box", price: 640, compareAtPrice: 790, discountPercent: 19, categoryIds: ["kitchen"] }),
  item({ id: "p4", name: "Missing image sample", price: 199, imageUrls: [], onHand: 0, inStock: false, categoryIds: ["home"] }),
  item({ id: "p5", name: "Neem comb", price: 120, categoryIds: ["apparel"] }),
  item({ id: "p6", name: "Copper bottle", price: 980, categoryIds: ["kitchen"], bestSeller: true }),
  item({ id: "p7", name: "Jute tote", price: 350, categoryIds: ["apparel"] }),
  item({ id: "p8", name: "Incense set", price: 220, categoryIds: ["home"] }),
  ...Array.from({ length: 10 }, (_, index) => item({ id: `x${index}`, name: `Catalog item ${index + 1}`, price: 150 + index * 40, categoryIds: index % 2 ? ["kitchen"] : ["home"] })),
];

const components = [
  { product: products[0], quantity: 1 },
  { product: products[1], quantity: 1 },
];
const pricing = allocateBundlePrices(components.map((entry) => ({ productId: entry.product.id, price: entry.product.price, quantity: entry.quantity })), "PERCENT", 15);

export const marketplaceFixture: StorePayload = {
  marketplace: true,
  published: true,
  theme: { ...DEFAULT_STORE_THEME, font: "manrope", secondaryColor: "#0f766e" },
  tracking: DEFAULT_STORE_TRACKING,
  storeName: "Samanga",
  logoUrl: null,
  accentColor: "#9f1239",
  slides: [],
  categories: [
    { id: "apparel", name: "Apparel", slug: "apparel" },
    { id: "home", name: "Home", slug: "home" },
    { id: "kitchen", name: "Kitchen", slug: "kitchen" },
  ],
  featuredProductIds: ["p1", "p3"],
  bundles: [{ id: "11111111-1111-4111-8111-111111111111", name: "Host set", pricingMode: "PERCENT", priceValue: 15, components, ...pricing }],
  products: {
    items: products,
    featured: products.filter((product) => ["p1", "p3"].includes(product.id)),
    bestSellers: products.filter((product) => product.bestSeller && !["p1", "p3"].includes(product.id)),
    page: 1,
    pageSize: 24,
    total: products.length,
    related: products,
  },
  workspace: "samanga",
  footer: {
    appearance: { layout: "columns", backgroundColor: "#18181b", textColor: "#fafafa", headingColor: "#ffffff", accentColor: "#9f1239", borderColor: "#3f3f46" },
    brand: { logoUrl: null, name: "Samanga", tagline: "Handmade goods, packed for delivery across India." },
    shop: [{ label: "Apparel", href: "/store/samanga?category=apparel" }, { label: "Home", href: "/store/samanga?category=home" }],
    support: [{ label: "WhatsApp support", href: "https://wa.me/919800000000", external: true }],
    policies: [{ label: "Returns", href: "/store/samanga/returns" }],
    social: [{ id: "instagram", label: "Instagram", href: "https://instagram.com" }],
    business: { name: "Samanga", lines: ["GSTIN 29AAAAA0000A1Z5", "Bengaluru, Karnataka"] },
    trust: [{ label: "UPI" }, { label: "Cash on delivery" }],
    poweredBy: true,
    copyrightName: "Samanga",
  },
};
