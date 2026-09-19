import { z } from "zod";
import { ORDER_SOURCES, ORDER_STATUSES, PAYMENT_STATUSES } from "@/types/domain";

export const addressInput = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().min(8).optional(),
  line1: z.string().min(3),
  line2: z.string().optional(),
  city: z.string().min(2),
  state: z.string().min(2),
  pincode: z.string().regex(/^\d{6}$/),
  country: z.string().min(2).default("IN"),
});

export const createOrderSchema = z.object({
  orderNumber: z.string().optional(),
  source: z.enum(ORDER_SOURCES).optional(),
  customer: z.object({
    name: z.string().min(2),
    phone: z.string().min(8),
    email: z.string().email().optional().or(z.literal("")),
  }),
  shippingAddress: addressInput,
  billingSameAsShipping: z.boolean().optional(),
  billingAddress: addressInput.optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  lineItems: z
    .array(
      z.object({
        title: z.string().min(1),
        sku: z.string().optional(),
        quantity: z.coerce.number().int().min(1),
        unitPrice: z.coerce.number().min(0),
        weightGrams: z.coerce.number().int().min(0).optional(),
      })
    )
    .min(1),
  createShipment: z.boolean().optional(),
  shipment: z
    .object({
      weightGrams: z.coerce.number().int().min(1).optional(),
      lengthCm: z.coerce.number().min(0).optional(),
      widthCm: z.coerce.number().min(0).optional(),
      heightCm: z.coerce.number().min(0).optional(),
      serviceCode: z.string().optional(),
    })
    .optional(),
});

export const orderListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  source: z.enum(ORDER_SOURCES).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z.string().optional(),
});
