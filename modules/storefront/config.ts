import { z } from "zod";

export const storeThemeSchema = z.object({
  version: z.literal(1).default(1),
  secondaryColor: z.string().regex(/^#[0-9a-f]{6}$/i).default("#0f766e"),
  font: z.enum(["geist", "inter", "manrope"]).default("geist"),
});
const provider = (pattern: RegExp) => z.object({
  id: z.string().trim().max(80).refine((id) => !id || pattern.test(id), "Invalid tracking ID.").default(""),
  enabled: z.boolean().default(false),
  delivery: z.enum(["direct", "gtm"]).default("direct"),
});
export const storeTrackingSchema = z.object({
  version: z.literal(1).default(1),
  meta: provider(/^\d{5,30}$/).default({ id: "", enabled: false, delivery: "direct" }),
  ga4: provider(/^G-[A-Z0-9]+$/).default({ id: "", enabled: false, delivery: "direct" }),
  clarity: provider(/^[a-z0-9]{3,30}$/i).default({ id: "", enabled: false, delivery: "direct" }),
  gtm: z.object({ id: z.string().trim().regex(/^(?:GTM-[A-Z0-9]+)?$/).default(""), enabled: z.boolean().default(false) }).default({ id: "", enabled: false }),
});
export type StoreTheme = z.infer<typeof storeThemeSchema>;
export type StoreTrackingConfig = z.infer<typeof storeTrackingSchema>;
export const DEFAULT_STORE_THEME = storeThemeSchema.parse({});
export const DEFAULT_STORE_TRACKING = storeTrackingSchema.parse({});
export function normalizeStoreTheme(value: unknown) { return storeThemeSchema.safeParse(value).data ?? DEFAULT_STORE_THEME; }
export function normalizeStoreTracking(value: unknown) { return storeTrackingSchema.safeParse(value).data ?? DEFAULT_STORE_TRACKING; }
export function contrastText(hex: string) {
  const color = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#E11D48";
  const channels = [1, 3, 5].map((offset) => {
    const n = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.179 ? "#18181b" : "#ffffff";
}
