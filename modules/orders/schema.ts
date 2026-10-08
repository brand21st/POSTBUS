import { z } from "zod";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { ORDER_SOURCES, ORDER_STATUSES, PAYMENT_STATUSES } from "@/types/domain";

const indiaMobile = z
  .string()
  .trim()
  .transform((value) => extractIndiaMobileDigits(value) ?? value.replace(/\D/g, ""))
  .refine((value) => extractIndiaMobileDigits(value) !== null, {
    message: "Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.",
  })
  .transform((value) => extractIndiaMobileDigits(value)!);

export const addressInput = z.object({
  name: z.string().min(2).optional(),
  phone: indiaMobile.optional(),
  line1: z.string().min(3),
  line2: z.string().optional(),
  city: z.string().min(2),
  state: z.string().min(2),
  pincode: z.string().regex(/^\d{6}$/),
  country: z.string().min(2).default("IN"),
});

/** HTML number inputs send "" or 0; treat those as “not set”. */
export const optionalPositiveInt = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return value;
}, z.coerce.number().int().min(1).optional());

export const optionalDimensionCm = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) return undefined;
  return value;
}, z.coerce.number().min(0).max(150).optional());

export const createOrderSchema = z.object({
  orderNumber: z.string().optional(),
  source: z.enum(ORDER_SOURCES).optional(),
  customer: z.object({
    name: z.string().min(2),
    phone: indiaMobile,
    email: z.string().email().optional().or(z.literal("")),
  }),
  shippingAddress: addressInput,
  billingSameAsShipping: z.boolean().optional(),
  billingAddress: addressInput.optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  amountPaid: z.coerce.number().min(0).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  lineItems: z
    .array(
      z.object({
        productId: z.string().uuid().optional(),
        title: z.string().min(1).optional(),
        sku: z.string().optional(),
        quantity: z.coerce.number().int().min(1),
        unitPrice: z.coerce.number().min(0).optional(),
        weightGrams: z.coerce.number().int().min(0).optional(),
      })
    )
    .min(1),
  createShipment: z.boolean().optional(),
  shipment: z
    .object({
      weightGrams: optionalPositiveInt,
      lengthCm: optionalDimensionCm,
      widthCm: optionalDimensionCm,
      heightCm: optionalDimensionCm,
      serviceCode: z.string().optional(),
    })
    .optional(),
}).superRefine((value, ctx) => {
  value.lineItems.forEach((item, index) => {
    if (!item.productId && !item.title?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["lineItems", index, "title"],
        message: "Item title is required.",
      });
    }
  });
  if (value.paymentStatus !== "PARTIAL") return;
  if (value.lineItems.some((item) => item.productId)) return;
  const total = value.lineItems.reduce((sum, item) => sum + (item.unitPrice ?? 0) * item.quantity, 0);
  const paid = value.amountPaid ?? 0;
  if (paid <= 0) {
    ctx.addIssue({
      code: "custom",
      path: ["amountPaid"],
      message: "Enter how much the customer already paid.",
    });
  } else if (paid >= total && total > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["amountPaid"],
      message: "Partial payment must be less than the order total.",
    });
  }
});

export const updateOrderWeightsSchema = z
  .object({
    parcelWeightMode: z.enum(["auto", "manual"]),
    parcelWeightGrams: z.coerce.number().int().min(1).optional(),
    lineItems: z
      .array(
        z.object({
          id: z.string().uuid(),
          weightGrams: z.coerce.number().int().min(0),
          weightMode: z.enum(["auto", "manual"]).optional(),
        })
      )
      .min(1),
  })
  .superRefine((value, ctx) => {
    if (value.parcelWeightMode === "manual" && value.parcelWeightGrams == null) {
      ctx.addIssue({
        code: "custom",
        path: ["parcelWeightGrams"],
        message: "Enter the box weight in grams.",
      });
    }
  });

export const orderListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  source: z.enum(ORDER_SOURCES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z.string().optional(),
  includeCounts: z.string().optional(),
  todayFrom: z.string().optional(),
  todayTo: z.string().optional(),
  yesterdayFrom: z.string().optional(),
  yesterdayTo: z.string().optional(),
});

export const bulkOrderStatusSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(100),
  action: z.literal("fulfill"),
});
