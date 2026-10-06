export function discountPercent(price: number, compareAt?: number | null) {
  if (compareAt == null || !Number.isFinite(compareAt) || compareAt <= price || price < 0) return null;
  return Math.round(((compareAt - price) / compareAt) * 100);
}

export function formatStorePrice(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}
