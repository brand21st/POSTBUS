const WEIGHT_TO_GRAMS: Record<string, number> = {
  kg: 1000,
  g: 1,
  lbs: 453.59237,
  oz: 28.349523125,
};

const LENGTH_TO_CM: Record<string, number> = {
  m: 100,
  cm: 1,
  mm: 0.1,
  in: 2.54,
  yd: 91.44,
};

export function normalizeWooWeightToGrams(value: unknown, unit: string | null | undefined) {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const factor = WEIGHT_TO_GRAMS[(unit || "kg").toLowerCase()];
  if (!factor) return null;
  return Math.max(1, Math.round(amount * factor));
}

export function normalizeWooLengthToCm(value: unknown, unit: string | null | undefined) {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const factor = LENGTH_TO_CM[(unit || "cm").toLowerCase()];
  if (!factor) return null;
  const cm = amount * factor;
  return Math.round(cm * 1000) / 1000;
}

export function readWooMeasurementUnits(
  settings: Array<{ id?: string; value?: string }> | null | undefined
) {
  const rows = settings ?? [];
  const weight = rows.find((row) => row.id === "woocommerce_weight_unit")?.value || "kg";
  const dimension = rows.find((row) => row.id === "woocommerce_dimension_unit")?.value || "cm";
  return { weightUnit: weight.toLowerCase(), dimensionUnit: dimension.toLowerCase() };
}
