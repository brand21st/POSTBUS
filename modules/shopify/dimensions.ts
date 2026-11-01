/**
 * Shopify measurement normalization and PostBus package selection.
 *
 * Admin GraphQL 2026-04 InventoryItemMeasurement exposes weight only.
 * packedDimensions is not a field on that version. Saved shipping packages
 * are not readable (no shippingPackages / shippingPackage query). Dimensions
 * therefore come from variant or product metafields, then from PostBus packages.
 */

export type DimensionSource =
  | "shopify"
  | "postbus_package"
  | "postbus_default"
  | "postbus"
  | "postbus_preset"
  | "postbus_custom"
  | "autopack_history";

export type CmBox = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export type PackageOption = CmBox & {
  id: string;
  name: string;
};

export type ShipmentUnit = {
  quantity: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
};

export type ResolvedShipmentDimensions = CmBox & {
  source: DimensionSource;
  packageId?: string;
  packageName?: string;
  /** packaging_history row that justifies an AutoPack choice. */
  evidenceId?: string;
  /** Merchant pressed Apply on an AutoPack suggestion. */
  merchantAccepted?: boolean;
};

export type MetafieldEntry = {
  namespace?: string | null;
  key?: string | null;
  value?: string | null;
  type?: string | null;
};

const CM_PER_UNIT: Record<string, number> = {
  mm: 0.1,
  millimeter: 0.1,
  millimeters: 0.1,
  millimetre: 0.1,
  millimetres: 0.1,
  cm: 1,
  centimeter: 1,
  centimeters: 1,
  centimetre: 1,
  centimetres: 1,
  m: 100,
  meter: 100,
  meters: 100,
  metre: 100,
  metres: 100,
  in: 2.54,
  inch: 2.54,
  inches: 2.54,
  ft: 30.48,
  foot: 30.48,
  feet: 30.48,
};

const AXIS_RULES: Array<{ axis: "length" | "width" | "height"; pattern: RegExp }> = [
  { axis: "length", pattern: /(?:^|_)(length_cm|length)$/ },
  { axis: "width", pattern: /(?:^|_)(width_cm|width|breadth)$/ },
  { axis: "height", pattern: /(?:^|_)(height_cm|height)$/ },
];

function roundCm(value: number) {
  return Math.round(value * 100) / 100;
}

function positiveCm(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

export function shopifyDimensionToCm(value: unknown, unit?: string | null): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "object") {
    const row = value as { value?: unknown; unit?: string | null };
    return shopifyDimensionToCm(row.value, row.unit ?? unit);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return shopifyDimensionToCm(JSON.parse(trimmed) as unknown, unit);
      } catch {
        // Fall through to numeric + unit suffix parsing.
      }
    }
    const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/);
    if (match) {
      return shopifyDimensionToCm(Number(match[1]), match[2] || unit);
    }
    return null;
  }
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const key = String(unit || "").trim().toLowerCase();
  if (!key) return roundCm(amount);
  const factor = CM_PER_UNIT[key] ?? (key.endsWith("s") ? CM_PER_UNIT[key.slice(0, -1)] : undefined);
  if (!factor) return null;
  const cm = amount * factor;
  return cm > 0 ? roundCm(cm) : null;
}

function classifyAxis(key: string) {
  const normalized = key.trim().toLowerCase();
  for (const rule of AXIS_RULES) {
    if (!rule.pattern.test(normalized)) continue;
    const stem = normalized.replace(rule.pattern, "").replace(/_+$/, "");
    return { axis: rule.axis, stem };
  }
  return null;
}

function tripleFromText(value: string | null | undefined): CmBox | null {
  const match = String(value ?? "")
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*[x×]\s*(-?\d+(?:\.\d+)?)\s*[x×]\s*(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/i);
  if (!match) return null;
  const lengthCm = shopifyDimensionToCm(Number(match[1]), match[4]);
  const widthCm = shopifyDimensionToCm(Number(match[2]), match[4]);
  const heightCm = shopifyDimensionToCm(Number(match[3]), match[4]);
  if (lengthCm == null || widthCm == null || heightCm == null) return null;
  return { lengthCm, widthCm, heightCm };
}

export function dimsFromMetafieldEntries(entries: MetafieldEntry[]): CmBox | null {
  for (const entry of entries) {
    const key = String(entry.key ?? "").trim().toLowerCase();
    if (!/size|dimension/.test(key)) continue;
    const triple = tripleFromText(entry.value);
    if (triple) return triple;
  }

  const groups = new Map<string, Partial<Record<"length" | "width" | "height", number>>>();
  for (const entry of entries) {
    const classified = classifyAxis(String(entry.key ?? ""));
    if (!classified) continue;
    const cm = shopifyDimensionToCm(entry.value);
    if (cm == null) continue;
    const id = `${String(entry.namespace ?? "custom").toLowerCase()}.${classified.stem}`;
    const group = groups.get(id) ?? {};
    if (group[classified.axis] == null) group[classified.axis] = cm;
    groups.set(id, group);
  }
  for (const group of groups.values()) {
    if (group.length != null && group.width != null && group.height != null) {
      return { lengthCm: group.length, widthCm: group.width, heightCm: group.height };
    }
  }
  return null;
}

function hasBox(unit: ShipmentUnit): unit is ShipmentUnit & CmBox {
  return positiveCm(unit.lengthCm) != null && positiveCm(unit.widthCm) != null && positiveCm(unit.heightCm) != null;
}

function sorted(box: CmBox) {
  return [box.lengthCm, box.widthCm, box.heightCm].sort((left, right) => left - right);
}

export function unitFitsPackage(unit: CmBox, box: CmBox) {
  const item = sorted(unit);
  const pack = sorted(box);
  return item[0] <= pack[0] && item[1] <= pack[1] && item[2] <= pack[2];
}

function singleShopifyBox(units: ShipmentUnit[]): CmBox | null {
  if (units.length !== 1 || units[0]?.quantity !== 1 || !hasBox(units[0])) return null;
  return {
    lengthCm: units[0].lengthCm,
    widthCm: units[0].widthCm,
    heightCm: units[0].heightCm,
  };
}

function singleUnmeasuredUnit(units: ShipmentUnit[]) {
  return units.length === 1 && units[0]?.quantity === 1 && !hasBox(units[0]);
}

/**
 * Chooses one shipment box.
 * A single unfulfilled unit with its own measurements is stored as measured.
 * One PostBus package or the merchant default is used only for that same
 * single unit when the product has no measurements.
 * Two or more units are not auto-packed. Volume and rotation do not prove
 * that several pieces fit one carton, so those shipments stay unsized for
 * a manual choice.
 */
export function resolveShipmentDimensions(input: {
  units: ShipmentUnit[];
  packages?: PackageOption[];
  defaultPackage?: CmBox | null;
}): ResolvedShipmentDimensions | null {
  const units = input.units.filter((unit) => unit.quantity > 0);
  const product = singleShopifyBox(units);
  if (product) return { ...product, source: "shopify" };
  if (!singleUnmeasuredUnit(units)) return null;

  const packages = input.packages ?? [];
  if (packages.length === 1) {
    const only = packages[0];
    return {
      lengthCm: only.lengthCm,
      widthCm: only.widthCm,
      heightCm: only.heightCm,
      source: "postbus_package",
      packageId: only.id,
      packageName: only.name,
    };
  }
  if (packages.length > 1) return null;

  const fallback = input.defaultPackage;
  if (
    fallback &&
    positiveCm(fallback.lengthCm) &&
    positiveCm(fallback.widthCm) &&
    positiveCm(fallback.heightCm)
  ) {
    return { ...fallback, source: "postbus_default" };
  }
  return null;
}

export type ParcelDimensionRecord = {
  source: DimensionSource;
  packageId: string | null;
  packageName: string | null;
  unit: "cm";
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  evidenceId?: string;
  merchantAccepted?: boolean;
  syncedAt: string;
};

export function parcelDimensionsMetadata(
  choice: ResolvedShipmentDimensions,
  syncedAt = new Date().toISOString()
): ParcelDimensionRecord {
  return {
    source: choice.source,
    packageId: choice.packageId ?? null,
    packageName: choice.packageName ?? null,
    unit: "cm",
    lengthCm: choice.lengthCm,
    widthCm: choice.widthCm,
    heightCm: choice.heightCm,
    ...(choice.evidenceId ? { evidenceId: choice.evidenceId } : {}),
    ...(choice.merchantAccepted ? { merchantAccepted: true } : {}),
    syncedAt,
  };
}

export function mergeParcelDimensionsMetadata(existing: unknown, record: ParcelDimensionRecord) {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return { ...base, parcelDimensions: record };
}

export function readParcelDimensionSource(metadata: unknown) {
  return readParcelDimensionRecord(metadata)?.source ?? null;
}

export function readParcelDimensionRecord(
  metadata: unknown
): { source: string; evidenceId: string | null; merchantAccepted: boolean; packageId: string | null } | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = (metadata as { parcelDimensions?: Record<string, unknown> }).parcelDimensions;
  if (!record || typeof record.source !== "string") return null;
  return {
    source: record.source,
    evidenceId: typeof record.evidenceId === "string" ? record.evidenceId : null,
    merchantAccepted: record.merchantAccepted === true,
    packageId: typeof record.packageId === "string" ? record.packageId : null,
  };
}

export function dimensionSourceLabel(source: string | null | undefined) {
  switch (source) {
    case "shopify":
      return "Source: Shopify product measurement";
    case "postbus_default":
      return "Source: PostBus Default Package";
    case "postbus_preset":
      return "Source: Saved pack size";
    case "postbus_custom":
      return "Source: Custom size";
    case "autopack_history":
      return "Source: AutoPack (verified past box)";
    case "postbus":
    case "postbus_package":
    case "manual":
      return "Source: PostBus";
    default:
      return null;
  }
}

export function formatParcelSize(length?: number | null, width?: number | null, height?: number | null) {
  if (!(Number(length) > 0 && Number(width) > 0 && Number(height) > 0)) return "No size";
  const trim = (value: number) => String(Math.round(value * 100) / 100);
  return `${trim(Number(length))} × ${trim(Number(width))} × ${trim(Number(height))} cm`;
}

const MERCHANT_DIMENSION_SOURCES = new Set(["postbus", "manual", "postbus_preset", "postbus_custom"]);

/**
 * True when the merchant chose this size in PostBus. Sync and AutoPack never overwrite it.
 * Pass the whole metadata to also lock an AutoPack suggestion the merchant accepted.
 */
export function manualDimensionLock(source: string | null | undefined, metadata?: unknown) {
  if (source && MERCHANT_DIMENSION_SOURCES.has(source)) return true;
  if (metadata !== undefined) {
    const record = readParcelDimensionRecord(metadata);
    if (record?.source === "autopack_history" && record.merchantAccepted) return true;
  }
  return false;
}
