import { z } from "zod";
import type { PublicLinkRef } from "@/modules/customer-order-links/public";

export function storeLinkRef(parsed: { workspace?: string; token?: string; code?: string }): PublicLinkRef {
  if (parsed.token) return { kind: "token", token: parsed.token };
  return { kind: "path", workspace: parsed.workspace ?? "", publicId: parsed.code };
}

export const storeLinkFields = {
  workspace: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "This store link is not valid.")
    .optional(),
  token: z.string().trim().optional(),
  code: z.string().trim().optional(),
};

export const publicStoreQuery = z.object(storeLinkFields).refine((value) => Boolean(value.workspace || value.token), {
  message: "This store link is not valid.",
});

export const publicCatalogQuery = z
  .object({
    ...storeLinkFields,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(48).default(12),
    q: z.string().trim().max(80).optional(),
    categoryId: z.string().uuid().optional(),
  })
  .refine((value) => Boolean(value.workspace || value.token), {
    message: "This store link is not valid.",
  });

export const publicProductQuery = z
  .object({
    ...storeLinkFields,
    id: z.string().uuid("Product not found."),
  })
  .refine((value) => Boolean(value.workspace || value.token), {
    message: "This store link is not valid.",
  });

export const publicStoreQuoteSchema = z
  .object({
    ...storeLinkFields,
    paymentPreference: z.enum(["PREPAID", "COD"]),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.coerce.number().int().min(1).max(99),
        })
      )
      .min(1)
      .max(50),
  })
  .refine((value) => Boolean(value.workspace || value.token), {
    message: "This store link is not valid.",
  });

export const publicStoreEventSchema = z
  .object({
    ...storeLinkFields,
    eventType: z.enum(["PRODUCT_VIEW", "PRODUCT_CLICK", "ADD_TO_CART", "CART_OPENED", "CHECKOUT_STARTED", "PURCHASE"]),
    productId: z.string().uuid().optional(),
    quantity: z.coerce.number().int().min(1).max(99).optional(),
    value: z.coerce.number().min(0).max(10_000_000).optional(),
    sessionId: z.string().trim().max(100).optional(),
  })
  .refine((value) => Boolean(value.workspace || value.token), {
    message: "This store link is not valid.",
  });

export const storefrontSettingsSchema = z.object({
  storeName: z.string().trim().max(80).optional().nullable(),
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Use a hex color like #E11D48.")
    .optional()
    .nullable(),
  published: z.boolean().optional(),
  featuredProductIds: z.array(z.string().uuid()).max(24).optional(),
  seoTitle: z.string().trim().max(70).optional().nullable(),
  seoDescription: z.string().trim().max(180).optional().nullable(),
  footer: z.unknown().optional(),
});

export const storefrontSlideSchema = z.object({
  title: z.string().trim().max(80).optional().nullable(),
  subtitle: z.string().trim().max(160).optional().nullable(),
  ctaLabel: z.string().trim().max(40).optional().nullable(),
  ctaHref: z.string().trim().max(200).optional().nullable(),
  enabled: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});
