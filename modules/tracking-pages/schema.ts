import { z } from "zod";
import { SUBDOMAIN_PATTERN } from "./constants";

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

export const subdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SUBDOMAIN_PATTERN, "Use 1–48 characters: lowercase letters, numbers, and hyphens.");

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#([0-9a-fA-F]{6})$/, "Use a 6-digit hex color such as #E11D48.");

export const socialSchema = z.object({
  instagram: z.preprocess(emptyToNull, z.union([z.url(), z.null()]).optional()),
  facebook: z.preprocess(emptyToNull, z.union([z.url(), z.null()]).optional()),
  website: z.preprocess(emptyToNull, z.union([z.url(), z.null()]).optional()),
});

export const createTrackingPageSchema = z.object({
  subdomain: subdomainSchema,
  storeName: z.string().trim().min(2).max(80).optional(),
});

export const updateTrackingPageSchema = z.object({
  subdomain: subdomainSchema.optional(),
  storeName: z.string().trim().min(2).max(80).optional(),
  tagline: z.preprocess(emptyToNull, z.string().trim().max(160).nullable().optional()),
  about: z.preprocess(emptyToNull, z.string().trim().max(2000).nullable().optional()),
  primaryColor: hexColorSchema.optional(),
  backgroundColor: hexColorSchema.optional(),
  locationName: z.preprocess(emptyToNull, z.string().trim().max(80).nullable().optional()),
  line1: z.preprocess(emptyToNull, z.string().trim().max(160).nullable().optional()),
  line2: z.preprocess(emptyToNull, z.string().trim().max(160).nullable().optional()),
  city: z.preprocess(emptyToNull, z.string().trim().max(80).nullable().optional()),
  state: z.preprocess(emptyToNull, z.string().trim().max(80).nullable().optional()),
  pincode: z.preprocess(emptyToNull, z.union([z.string().regex(/^\d{6}$/), z.null()]).optional()),
  phone: z.preprocess(emptyToNull, z.string().trim().max(20).nullable().optional()),
  email: z.preprocess(emptyToNull, z.union([z.email(), z.null()]).optional()),
  whatsapp: z.preprocess(emptyToNull, z.string().trim().max(20).nullable().optional()),
  mapUrl: z.preprocess(emptyToNull, z.union([z.url(), z.null()]).optional()),
  social: socialSchema.optional(),
});

export const bannerMetaSchema = z.object({
  href: z.preprocess(emptyToNull, z.union([z.url(), z.null()]).optional()),
  alt: z.preprocess(emptyToNull, z.string().trim().max(120).nullable().optional()),
  sortOrder: z.coerce.number().int().min(0).max(2).optional(),
  enabled: z.boolean().optional(),
});

export const bannerUpdateSchema = z.object({
  banners: z
    .array(
      z.object({
        id: z.string().uuid(),
        href: z.preprocess(emptyToNull, z.union([z.url(), z.null()]).optional()),
        alt: z.preprocess(emptyToNull, z.string().trim().max(120).nullable().optional()),
        sortOrder: z.coerce.number().int().min(0).max(2).optional(),
        enabled: z.boolean().optional(),
      })
    )
    .max(3),
});

export const publicTrackSchema = z.object({
  query: z.string().trim().min(6, "Enter a barcode or tracking number."),
  subdomain: z.string().trim().toLowerCase().optional(),
});

export type UpdateTrackingPageInput = z.infer<typeof updateTrackingPageSchema>;
