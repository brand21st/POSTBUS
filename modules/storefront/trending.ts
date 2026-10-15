import type { StoreProduct } from "@/components/storefront/store-types";

export function trendingProducts(products: StoreProduct[], limit = 5) {
  const seen = new Set<string>();
  const ranked = [...products].sort((a, b) => Number(Boolean(b.bestSeller)) - Number(Boolean(a.bestSeller)) || a.name.localeCompare(b.name));
  const picked: StoreProduct[] = [];
  for (const product of ranked) {
    if (!product.inStock || seen.has(product.id)) continue;
    seen.add(product.id);
    picked.push(product);
    if (picked.length >= limit) break;
  }
  return picked;
}

export function searchMatches(products: StoreProduct[], query: string, limit = 5) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return products.filter((product) => product.name.toLowerCase().includes(needle) || product.sku.toLowerCase().includes(needle)).slice(0, limit);
}

const ORDER_WINDOW_SECONDS = 18 * 60 * 60;

export function istSeconds(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return read("hour") * 3600 + read("minute") * 60 + read("second");
}

export function orderWindowRemaining(now = new Date()) {
  const left = ORDER_WINDOW_SECONDS - istSeconds(now);
  return left > 0 ? left : null;
}

export function formatOrderWindow(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(secs).padStart(2, "0")}s`;
}
