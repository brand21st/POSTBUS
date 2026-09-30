import { indiaPostVolumetricWeightGrams } from "@/modules/india-post/endpoints";

/** Shopify/Postbus grams → India Post physical_weight (whole grams). */
export function toIndiaPostPhysicalWeightGrams(grams: number | string | null | undefined) {
  const value = Number(grams);
  if (!Number.isFinite(value)) return null;
  return Math.round(value);
}

export function indiaPostChargeableWeightGrams(input: {
  physicalGrams: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
}) {
  const physical = Math.max(0, Math.round(Number(input.physicalGrams) || 0));
  const volumetric = indiaPostVolumetricWeightGrams(
    Number(input.lengthCm) || 0,
    Number(input.widthCm) || 0,
    Number(input.heightCm) || 0
  );
  return Math.max(physical, volumetric || physical);
}

export const INDIA_POST_WEIGHT_MIN_G = 1;
export const INDIA_POST_WEIGHT_MAX_G = 35_000;
