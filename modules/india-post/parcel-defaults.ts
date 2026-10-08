import { isParcelArticle } from "@/modules/india-post/article-validator";
import type { DraftArticle } from "@/modules/india-post/article-types";
import { INDIA_POST_WEIGHT_MAX_G, INDIA_POST_WEIGHT_MIN_G } from "@/modules/india-post/weight";

export const FALLBACK_PARCEL_LENGTH_CM = 14;
export const FALLBACK_PARCEL_WIDTH_CM = 9;
export const FALLBACK_PARCEL_HEIGHT_CM = 1;
export const FALLBACK_PARCEL_WEIGHT_G = 100;
export const PARCEL_LENGTH_MIN_CM = FALLBACK_PARCEL_LENGTH_CM;
export const PARCEL_LENGTH_MAX_CM = 150;
export const PARCEL_WIDTH_MIN_CM = FALLBACK_PARCEL_WIDTH_CM;
export const PARCEL_WIDTH_MAX_CM = 150;
export const PARCEL_HEIGHT_MIN_CM = FALLBACK_PARCEL_HEIGHT_CM;
export const PARCEL_HEIGHT_MAX_CM = 150;

export type WorkspaceParcelDefaults = {
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  weightGrams: number | null;
};

const EMPTY_DEFAULTS: WorkspaceParcelDefaults = {
  lengthCm: null,
  widthCm: null,
  heightCm: null,
  weightGrams: null,
};

function optionalPositive(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function parcelDefaultsFromConnection(
  row?: {
    default_length_cm?: number | string | null;
    default_width_cm?: number | string | null;
    default_height_cm?: number | string | null;
    default_weight_grams?: number | string | null;
    defaultLengthCm?: number | string | null;
    defaultWidthCm?: number | string | null;
    defaultHeightCm?: number | string | null;
    defaultWeightGrams?: number | string | null;
  } | null
): WorkspaceParcelDefaults {
  if (!row) return { ...EMPTY_DEFAULTS };
  return {
    lengthCm: optionalPositive(row.default_length_cm ?? row.defaultLengthCm),
    widthCm: optionalPositive(row.default_width_cm ?? row.defaultWidthCm),
    heightCm: optionalPositive(row.default_height_cm ?? row.defaultHeightCm),
    weightGrams: optionalPositive(row.default_weight_grams ?? row.defaultWeightGrams),
  };
}

export function parseParcelDefaultsInput(body: Record<string, unknown>): WorkspaceParcelDefaults {
  const lengthCm = optionalPositive(body.lengthCm ?? body.length_cm);
  const widthCm = optionalPositive(body.widthCm ?? body.width_cm);
  const heightCm = optionalPositive(body.heightCm ?? body.height_cm);
  const weightGrams = optionalPositive(body.weightGrams ?? body.weight_grams);

  const provided = {
    length: body.lengthCm ?? body.length_cm,
    width: body.widthCm ?? body.width_cm,
    height: body.heightCm ?? body.height_cm,
    weight: body.weightGrams ?? body.weight_grams,
  };
  for (const [label, raw] of Object.entries(provided)) {
    if (raw == null || raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new Error(`${label} must be a number.`);
    }
  }

  return { lengthCm, widthCm, heightCm, weightGrams };
}

export function parcelDefaultsValidationError(defaults: WorkspaceParcelDefaults): string | null {
  if (
    defaults.lengthCm != null &&
    (defaults.lengthCm < PARCEL_LENGTH_MIN_CM || defaults.lengthCm > PARCEL_LENGTH_MAX_CM)
  ) {
    return `Default length must be between ${PARCEL_LENGTH_MIN_CM} and ${PARCEL_LENGTH_MAX_CM} cm.`;
  }
  if (
    defaults.widthCm != null &&
    (defaults.widthCm < PARCEL_WIDTH_MIN_CM || defaults.widthCm > PARCEL_WIDTH_MAX_CM)
  ) {
    return `Default width must be between ${PARCEL_WIDTH_MIN_CM} and ${PARCEL_WIDTH_MAX_CM} cm.`;
  }
  if (
    defaults.heightCm != null &&
    (defaults.heightCm < PARCEL_HEIGHT_MIN_CM || defaults.heightCm > PARCEL_HEIGHT_MAX_CM)
  ) {
    return `Default height must be between ${PARCEL_HEIGHT_MIN_CM} and ${PARCEL_HEIGHT_MAX_CM} cm.`;
  }
  if (
    defaults.weightGrams != null &&
    (defaults.weightGrams < INDIA_POST_WEIGHT_MIN_G || defaults.weightGrams > INDIA_POST_WEIGHT_MAX_G)
  ) {
    return `Default weight must be between ${INDIA_POST_WEIGHT_MIN_G} and ${INDIA_POST_WEIGHT_MAX_G} grams.`;
  }
  return null;
}

function fillMeasure(current: number, setting: number | null, fallback: number) {
  if (Number(current) > 0) return Number(current);
  if (setting != null && setting > 0) return setting;
  return fallback;
}

/** Fill empty parcel size/weight from workspace Settings, then India Post minima. */
export function applyWorkspaceParcelDefaults(
  draft: DraftArticle,
  defaults: WorkspaceParcelDefaults = EMPTY_DEFAULTS
): DraftArticle {
  const next: DraftArticle = { ...draft };
  if (!(Number(next.weightGrams) > 0)) {
    next.weightGrams = defaults.weightGrams != null && defaults.weightGrams > 0
      ? Math.round(defaults.weightGrams)
      : FALLBACK_PARCEL_WEIGHT_G;
  }
  if (!isParcelArticle(next.serviceCode, next.weightGrams)) {
    return next;
  }
  next.lengthCm = fillMeasure(next.lengthCm, defaults.lengthCm, FALLBACK_PARCEL_LENGTH_CM);
  next.widthCm = fillMeasure(next.widthCm, defaults.widthCm, FALLBACK_PARCEL_WIDTH_CM);
  next.heightCm = fillMeasure(next.heightCm, defaults.heightCm, FALLBACK_PARCEL_HEIGHT_CM);
  return next;
}

export function parcelDefaultsApiPayload(defaults: WorkspaceParcelDefaults) {
  return {
    defaultLengthCm: defaults.lengthCm,
    defaultWidthCm: defaults.widthCm,
    defaultHeightCm: defaults.heightCm,
    defaultWeightGrams: defaults.weightGrams != null ? Math.round(defaults.weightGrams) : null,
    default_length_cm: defaults.lengthCm,
    default_width_cm: defaults.widthCm,
    default_height_cm: defaults.heightCm,
    default_weight_grams: defaults.weightGrams != null ? Math.round(defaults.weightGrams) : null,
  };
}
