import { z } from "zod";

export const tutorialStatusSchema = z.enum(["draft", "published"]);

export const customerTutorialQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
  q: z.string().trim().optional(),
  category: z.string().trim().optional(),
});

export const adminTutorialQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().optional(),
  categoryId: z.string().uuid().optional(),
  status: tutorialStatusSchema.or(z.literal("all")).optional(),
});

export const upsertTutorialSchema = z.object({
  title: z.string().trim().min(1).max(200),
  youtubeUrl: z.string().trim().min(1).max(500),
  categoryId: z.string().uuid(),
  description: z.string().trim().max(2000).optional().nullable(),
  status: tutorialStatusSchema.default("draft"),
  sortOrder: z.coerce.number().int().optional(),
});

export const patchTutorialSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  youtubeUrl: z.string().trim().min(1).max(500).optional(),
  categoryId: z.string().uuid().optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  status: tutorialStatusSchema.optional(),
  sortOrder: z.coerce.number().int().optional(),
});

export const tutorialStatusBodySchema = z.object({
  status: tutorialStatusSchema,
});

export const upsertCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const patchCategorySchema = upsertCategorySchema.partial();
