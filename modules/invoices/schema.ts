import { z } from "zod";

export const INVOICE_STATUSES = ["PENDING", "GENERATED", "FAILED"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

const HEX = /^#([0-9a-fA-F]{6})$/;

export const hexColorSchema = z
  .string()
  .trim()
  .transform((value) => (value.startsWith("#") ? value : `#${value}`))
  .pipe(z.string().regex(HEX, "Use a 6-digit hex color."))
  .transform((value) => value.toUpperCase());

export const invoiceAppearanceSchema = z.object({
  primaryColor: hexColorSchema,
  secondaryColor: hexColorSchema,
  accentColor: hexColorSchema,
  textColor: hexColorSchema,
  tableHeaderColor: hexColorSchema,
  borderColor: hexColorSchema,
  totalHighlightColor: hexColorSchema,
});

export type InvoiceAppearance = z.infer<typeof invoiceAppearanceSchema>;

export const DEFAULT_INVOICE_APPEARANCE: InvoiceAppearance = {
  primaryColor: "#007A4D",
  secondaryColor: "#E8F5F0",
  accentColor: "#007A4D",
  textColor: "#222222",
  tableHeaderColor: "#007A4D",
  borderColor: "#D1D5DB",
  totalHighlightColor: "#007A4D",
};

export const INVOICE_PRESETS: Record<string, InvoiceAppearance> = {
  Green: DEFAULT_INVOICE_APPEARANCE,
  Blue: {
    primaryColor: "#1D4ED8",
    secondaryColor: "#DBEAFE",
    accentColor: "#1D4ED8",
    textColor: "#1E293B",
    tableHeaderColor: "#1D4ED8",
    borderColor: "#BFDBFE",
    totalHighlightColor: "#1E40AF",
  },
  Purple: {
    primaryColor: "#6D28D9",
    secondaryColor: "#EDE9FE",
    accentColor: "#6D28D9",
    textColor: "#1F1633",
    tableHeaderColor: "#6D28D9",
    borderColor: "#DDD6FE",
    totalHighlightColor: "#5B21B6",
  },
  Orange: {
    primaryColor: "#C2410C",
    secondaryColor: "#FFEDD5",
    accentColor: "#EA580C",
    textColor: "#1C1917",
    tableHeaderColor: "#C2410C",
    borderColor: "#FED7AA",
    totalHighlightColor: "#9A3412",
  },
  Black: {
    primaryColor: "#111827",
    secondaryColor: "#F3F4F6",
    accentColor: "#111827",
    textColor: "#111827",
    tableHeaderColor: "#111827",
    borderColor: "#D1D5DB",
    totalHighlightColor: "#111827",
  },
};

export type InvoiceSettings = {
  appearance: InvoiceAppearance;
  gstin: string | null;
  businessEmail: string | null;
  website: string | null;
};

export function displayStoreWebsite(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    return url.hostname.replace(/\.$/, "").toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//i, "").split("/")[0]?.trim().toLowerCase() ?? "";
  }
}

export function pickStoreWebsite(candidates: Array<string | null | undefined>) {
  const hosts = candidates.map(displayStoreWebsite).filter(Boolean);
  const custom = hosts.filter((host) => !/\.myshopify\.com$/i.test(host));
  return custom.find((host) => host.startsWith("www.")) || custom[0] || hosts[0] || "";
}

function hexToRgbTuple(hex: string) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
  };
}

function channelLuminance(channel: number) {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string) {
  const { r, g, b } = hexToRgbTuple(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(foreground: string, background: string) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

export function readableTextOn(background: string) {
  return contrastRatio("#111111", background) >= contrastRatio("#FFFFFF", background) ? "#111111" : "#FFFFFF";
}

export type ContrastWarning = { field: string; message: string; suggestion: string };

export function invoiceContrastWarnings(appearance: InvoiceAppearance): ContrastWarning[] {
  const warnings: ContrastWarning[] = [];
  const page = "#FFFFFF";
  if (contrastRatio(appearance.textColor, page) < 4.5) {
    warnings.push({
      field: "textColor",
      message: "Body text may be hard to read on a white invoice.",
      suggestion: readableTextOn(page),
    });
  }
  if (contrastRatio(readableTextOn(appearance.tableHeaderColor), appearance.tableHeaderColor) < 4.5) {
    warnings.push({
      field: "tableHeaderColor",
      message: "Table header color is too close to both black and white text.",
      suggestion: DEFAULT_INVOICE_APPEARANCE.tableHeaderColor,
    });
  }
  if (contrastRatio(appearance.primaryColor, page) < 2) {
    warnings.push({
      field: "primaryColor",
      message: "Primary color is very light and may disappear when printed.",
      suggestion: DEFAULT_INVOICE_APPEARANCE.primaryColor,
    });
  }
  return warnings;
}

export function parseInvoiceAppearance(value: unknown): InvoiceAppearance {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const parsed = invoiceAppearanceSchema.safeParse({
    ...DEFAULT_INVOICE_APPEARANCE,
    ...record,
  });
  return parsed.success ? parsed.data : DEFAULT_INVOICE_APPEARANCE;
}

export function parseInvoiceSettings(row: {
  appearance?: unknown;
  gstin?: string | null;
  business_email?: string | null;
  businessEmail?: string | null;
  website?: string | null;
} | null): InvoiceSettings {
  return {
    appearance: parseInvoiceAppearance(row?.appearance),
    gstin: row?.gstin?.trim() || null,
    businessEmail: (row?.businessEmail ?? row?.business_email)?.trim() || null,
    website: pickStoreWebsite([row?.website]) || null,
  };
}

export function formatInvoiceNumber(year: number, sequence: number) {
  return `INV-${year}-${String(sequence).padStart(6, "0")}`;
}

export function shouldSkipInvoiceGeneration(status: string | null | undefined, filePath?: string | null) {
  return (status ?? "").toUpperCase() === "GENERATED" && Boolean(filePath?.trim());
}

export function istYear(date = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(date)
  );
}

export function istDateIso(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
