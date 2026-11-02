export type OfferOverlayInput = {
  productName: string;
  pricePaise?: number;
  compareAtPaise?: number | null;
  headline?: string | null;
  cta?: string | null;
  expiry?: string | null;
};

export function offerDiscountPercent(price: number, compareAt: number | null | undefined) {
  if (!Number.isFinite(price) || price < 0) return 0;
  if (compareAt == null || !Number.isFinite(compareAt) || compareAt <= price) return 0;
  return Math.round(((compareAt - price) / compareAt) * 100);
}

export function rupeesLabel(paise: number) {
  const rupees = Math.round(paise) / 100;
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: rupees % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function offerCopyFromInput(input: OfferOverlayInput) {
  const price = Number(input.pricePaise ?? 0);
  const compare = input.compareAtPaise == null ? null : Number(input.compareAtPaise);
  const off = offerDiscountPercent(price, compare);
  return {
    name: input.productName.trim().slice(0, 80),
    price: rupeesLabel(price),
    compareAt: compare != null && compare > price ? rupeesLabel(compare) : null,
    discountPercent: off,
    headline: (input.headline ?? "SPECIAL OFFER").trim().slice(0, 40) || "SPECIAL OFFER",
    cta: (input.cta ?? "SHOP NOW").trim().slice(0, 24) || "SHOP NOW",
    expiry: input.expiry?.trim().slice(0, 40) || null,
  };
}
