import { z } from "zod";
import { INVENTORY_MOVEMENT_REASONS } from "@/types/domain";

export const productPaymentFields = z
  .object({
    prepaidEnabled: z.boolean(),
    codEnabled: z.boolean(),
    codAdvancePercent: z.coerce.number().min(0).max(100).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.prepaidEnabled && !value.codEnabled) {
      ctx.addIssue({
        code: "custom",
        path: ["prepaidEnabled"],
        message: "Enable prepaid, COD, or both.",
      });
    }
  });

const createProductObject = z.object({
  name: z.string().trim().min(1, "Enter a product name.").max(200),
  sku: z.string().trim().min(1, "Enter a SKU.").max(64),
  price: z.coerce.number().min(0, "Price cannot be negative."),
  compareAtPrice: z.coerce.number().min(0).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  weightGrams: z.coerce.number().int().min(0, "Weight cannot be negative."),
  openingStock: z.coerce.number().int().min(0).default(0),
  prepaidEnabled: z.boolean().default(true),
  codEnabled: z.boolean().default(true),
  codAdvancePercent: z.coerce.number().min(0).max(100).optional(),
  returnAvailable: z.boolean().default(true),
  storeVisible: z.boolean().default(true),
  featured: z.boolean().optional(),
  lowStockThreshold: z.coerce.number().int().min(0).max(100000).optional(),
  categoryIds: z.array(z.string().uuid()).max(20).optional(),
  upsellProductIds: z.array(z.string().uuid()).max(8).optional(),
  crossSellProductIds: z.array(z.string().uuid()).max(8).optional(),
});

function requireAPaymentMode(
  value: { prepaidEnabled: boolean; codEnabled: boolean },
  ctx: z.RefinementCtx,
) {
  if (!value.prepaidEnabled && !value.codEnabled) {
    ctx.addIssue({
      code: "custom",
      path: ["prepaidEnabled"],
      message: "Enable prepaid, COD, or both.",
    });
  }
}

export const createProductSchema = createProductObject.superRefine(requireAPaymentMode);

/** Edit form: same fields as create, without opening stock, plus optional active. */
export const editProductFormSchema = createProductObject
  .omit({ openingStock: true })
  .extend({ active: z.boolean().optional() })
  .superRefine(requireAPaymentMode);

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    sku: z.string().trim().min(1).max(64).optional(),
    price: z.coerce.number().min(0).optional(),
    weightGrams: z.coerce.number().int().min(0).optional(),
    active: z.boolean().optional(),
    prepaidEnabled: z.boolean().optional(),
    codEnabled: z.boolean().optional(),
    codAdvancePercent: z.coerce.number().min(0).max(100).optional(),
    returnAvailable: z.boolean().optional(),
    imageUrls: z.array(z.string().trim().min(1)).max(3).optional(),
    compareAtPrice: z.coerce.number().min(0).optional().nullable(),
    description: z.string().trim().max(4000).optional().nullable(),
    storeVisible: z.boolean().optional(),
    featured: z.boolean().optional(),
    lowStockThreshold: z.coerce.number().int().min(0).max(100000).optional(),
    categoryIds: z.array(z.string().uuid()).max(20).optional(),
    upsellProductIds: z.array(z.string().uuid()).max(8).optional(),
    crossSellProductIds: z.array(z.string().uuid()).max(8).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.prepaidEnabled === false && value.codEnabled === false) {
      ctx.addIssue({
        code: "custom",
        path: ["prepaidEnabled"],
        message: "Enable prepaid, COD, or both.",
      });
    }
  });

export const adjustInventorySchema = z.object({
  quantityDelta: z.coerce.number().int().refine((value) => value !== 0, "Enter an adjustment other than zero."),
  note: z.string().trim().max(500).optional(),
  reason: z.enum(INVENTORY_MOVEMENT_REASONS).optional(),
});

export const productListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  active: z.enum(["true", "false", "all"]).optional(),
  categoryId: z.string().uuid().optional(),
  storeVisible: z.enum(["true", "false", "all"]).optional(),
  stock: z.enum(["all", "inStock", "lowStock", "outOfStock"]).optional(),
  prepaid: z.enum(["true", "false", "all"]).optional(),
  cod: z.enum(["true", "false", "all"]).optional(),
  bestSeller: z.enum(["true", "false", "all"]).optional(),
  priceMin: z.coerce.number().min(0).optional(),
  priceMax: z.coerce.number().min(0).optional(),
  stockMin: z.coerce.number().int().min(0).optional(),
  stockMax: z.coerce.number().int().min(0).optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  updatedFrom: z.string().datetime().optional(),
  updatedTo: z.string().datetime().optional(),
  analyticsRange: z.enum(["all", "7d", "30d", "90d"]).default("all"),
  sort: z
    .enum([
      "newest",
      "oldest",
      "nameAsc",
      "nameDesc",
      "priceAsc",
      "priceDesc",
      "stockAsc",
      "stockDesc",
      "orders",
      "units",
      "bestSeller",
      "updated",
    ])
    .default("newest"),
}).superRefine((value, ctx) => {
  if (value.priceMin != null && value.priceMax != null && value.priceMin > value.priceMax) {
    ctx.addIssue({ code: "custom", path: ["priceMax"], message: "Maximum price must be at least the minimum." });
  }
  if (value.stockMin != null && value.stockMax != null && value.stockMin > value.stockMax) {
    ctx.addIssue({ code: "custom", path: ["stockMax"], message: "Maximum stock must be at least the minimum." });
  }
});

export const productBulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  active: z.boolean().optional(),
  storeVisible: z.boolean().optional(),
});

export const productRecommendationsSchema = z.object({
  upsellProductIds: z.array(z.string().uuid()).max(8).default([]),
  crossSellProductIds: z.array(z.string().uuid()).max(8).default([]),
});

export const inventoryAnalyticsQuery = z.object({
  range: z.enum(["today", "7d", "30d", "custom"]).default("30d"),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const inventoryMovementListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  productId: z.string().uuid().optional(),
  reason: z.enum(INVENTORY_MOVEMENT_REASONS).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const productImageSlotQuery = z.object({
  slot: z.coerce.number().int().min(0).max(2),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Enter a category name.").max(80),
  description: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
  imagePath: z.string().trim().max(500).optional().nullable(),
  productIds: z.array(z.string().uuid()).max(500).optional(),
});

export const categoryUpdateSchema = categorySchema.partial();

export const categoryReorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});
