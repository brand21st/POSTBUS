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
  amountPaid: z.coerce.number().min(0).optional(),
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
}).superRefine((value, ctx) => {
  if (value.paymentStatus !== "PARTIAL") return;
  const total = value.lineItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
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
});

export const bulkOrderStatusSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(100),
  action: z.literal("fulfill"),
});
