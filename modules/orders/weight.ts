export type ParcelWeightLine = {
  quantity?: number | null;
  weight_grams?: number | null;
  weightGrams?: number | null;
};

/** Grams India Post should book. Manual box weight wins, then the product sum, then 100 g. */
export function bookingBoxWeightGrams(input: {
  parcelWeightMode?: string | null;
  parcelWeightGrams?: number | null;
  lineItems?: ParcelWeightLine[] | null;
  explicitGrams?: number | null;
}) {
  if ((input.parcelWeightMode ?? "auto").toLowerCase() === "manual") {
    const manual = Number(input.parcelWeightGrams);
    if (Number.isFinite(manual) && manual >= 1) return Math.round(manual);
  }

  const sum = (input.lineItems ?? []).reduce((total, item) => {
    const grams = Number(item.weightGrams ?? item.weight_grams);
    const quantity = Number(item.quantity) || 0;
    if (!Number.isFinite(grams) || grams <= 0 || quantity <= 0) return total;
    return total + grams * quantity;
  }, 0);
  if (sum > 0) return Math.round(sum);

  const explicit = Number(input.explicitGrams);
  if (Number.isFinite(explicit) && explicit >= 1) return Math.round(explicit);
  return 100;
}
