import { z } from "zod";
import { createOrderSchema, updateOrderAddressSchema, updateOrderWeightsSchema } from "@/modules/orders/schema";
import { ORDER_STATUSES } from "@/types/domain";
import { MERCHANT_BULK_MAX_ROWS, MERCHANT_PAGE_MAX } from "@/modules/merchant-api/rate-limit";

const address = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional(),
  line1: z.string().min(3),
  line2: z.string().optional(),
  city: z.string().min(2),
  state: z.string().min(2),
  pincode: z.string().regex(/^\d{6}$/),
  country: z.string().min(2).optional(),
});

const lineItem = z.object({
  product_id: z.string().uuid().optional(),
  title: z.string().min(1).optional(),
  sku: z.string().optional(),
  quantity: z.coerce.number().int().min(1),
  unit_price: z.coerce.number().min(0).optional(),
  weight_grams: z.coerce.number().int().min(0).optional(),
});

export const merchantCreateOrderSchema = z.object({
  external_order_id: z.string().trim().min(1).max(120).optional(),
  customer: z.object({
    name: z.string().min(2),
    phone: z.string().min(10),
    email: z.string().email().optional().or(z.literal("")),
  }),
  shipping_address: address,
  billing_same_as_shipping: z.boolean().optional(),
  billing_address: address.optional(),
  payment_status: z.enum(["PENDING", "PAID", "PARTIAL", "COD", "REFUNDED", "FAILED"]).optional(),
  amount_paid: z.coerce.number().min(0).optional(),
  extra_cod_charge: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  line_items: z.array(lineItem).min(1),
  india_post_service: z.enum(["SP_INLAND_PARCEL", "BUSINESS_PARCEL"]).optional(),
});

export const merchantBulkOrdersSchema = z.object({
  orders: z.array(merchantCreateOrderSchema).min(1).max(MERCHANT_BULK_MAX_ROWS),
});

export const merchantPatchOrderSchema = z
  .object({
    shipping_address: address.optional(),
    parcel_weight_mode: z.enum(["auto", "manual"]).optional(),
    parcel_weight_grams: z.coerce.number().int().min(1).optional(),
    line_items: z
      .array(
        z.object({
          id: z.string().uuid(),
          weight_grams: z.coerce.number().int().min(0),
          weight_mode: z.enum(["auto", "manual"]).optional(),
        })
      )
      .min(1)
      .optional(),
  })
  .refine((value) => value.shipping_address || value.parcel_weight_mode || value.line_items, {
    message: "Provide at least one writable field.",
  });

export const merchantBookOrderSchema = z.object({
  weight_grams: z.coerce.number().int().min(1).optional(),
  length_cm: z.coerce.number().min(0).max(150).optional(),
  width_cm: z.coerce.number().min(0).max(150).optional(),
  height_cm: z.coerce.number().min(0).max(150).optional(),
  service_code: z.enum(["SP_INLAND_PARCEL", "BUSINESS_PARCEL"]).optional(),
});

export const merchantOrderListQuery = z.object({
  updated_since: z.string().min(1).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(MERCHANT_PAGE_MAX).default(20),
  cursor: z.string().min(1).optional(),
});

export const merchantShipmentListQuery = z.object({
  updated_since: z.string().optional(),
  status: z.string().optional(),
  order_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MERCHANT_PAGE_MAX).default(20),
  cursor: z.string().min(1).optional(),
});

export function toCreateOrderInput(body: z.infer<typeof merchantCreateOrderSchema>) {
  return createOrderSchema.parse({
    source: "API",
    customer: body.customer,
    shippingAddress: body.shipping_address,
    billingSameAsShipping: body.billing_same_as_shipping,
    billingAddress: body.billing_address,
    paymentStatus: body.payment_status,
    amountPaid: body.amount_paid,
    extraCodCharge: body.extra_cod_charge,
    metadata: {
      ...(body.metadata ?? {}),
      ...(body.external_order_id ? { external_order_id: body.external_order_id } : {}),
    },
    lineItems: body.line_items.map((item) => ({
      productId: item.product_id,
      title: item.title,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      weightGrams: item.weight_grams,
    })),
  });
}

export function toAddressInput(body: z.infer<typeof address>) {
  return updateOrderAddressSchema.parse(body);
}

export function toWeightInput(body: z.infer<typeof merchantPatchOrderSchema>) {
  return updateOrderWeightsSchema.parse({
    parcelWeightMode: body.parcel_weight_mode ?? "auto",
    parcelWeightGrams: body.parcel_weight_grams,
    lineItems: (body.line_items ?? []).map((item) => ({
      id: item.id,
      weightGrams: item.weight_grams,
      weightMode: item.weight_mode,
    })),
  });
}
