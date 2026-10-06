import { z } from "zod";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { CUSTOMER_ORDER_LINK_STATUSES } from "@/types/domain";

export const CUSTOMER_ORDER_LINK_TOKEN =
  /^(?:[a-f0-9]{64}|[2-9a-hjkmnp-z]{4}(?:-[2-9a-hjkmnp-z]{4}){3})$/i;

export function normalizeCustomerOrderLinkToken(token: string) {
  return token.trim().toLowerCase();
}

export const CUSTOMER_ORDER_WORKSPACE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CUSTOMER_ORDER_PUBLIC_ID = /^[a-f0-9]{4}$/i;
export const WHATSAPP_ORDER_FORM_SLUG = "whatsapp-order-form";

export function customerOrderWorkspaceSlug(name: string, slug?: string | null) {
  const fromName = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (CUSTOMER_ORDER_WORKSPACE.test(fromName)) return fromName;
  const fromSlug = slug?.trim().toLowerCase() ?? "";
  if (CUSTOMER_ORDER_WORKSPACE.test(fromSlug)) return fromSlug;
  return "workspace";
}

export function customerOrderLinkPublicId(id: string) {
  return id.replace(/-/g, "").slice(0, 4).toLowerCase();
}

export function customerOrderLinkPath(workspace: string, publicId: string) {
  return `/order/${workspace}/${publicId}/${WHATSAPP_ORDER_FORM_SLUG}`;
}

export function parseCustomerOrderLinkParts(parts: string[]) {
  const segments = parts.map((part) => decodeURIComponent(part).trim()).filter(Boolean);
  if (segments.length === 1) return { token: segments[0] };
  if (segments.length === 2) {
    return { workspace: segments[0].toLowerCase(), token: segments[1] };
  }
  if (segments.length === 3) {
    const [workspace, publicId, last] = segments;
    const slug = last.toLowerCase();
    if (slug === WHATSAPP_ORDER_FORM_SLUG) {
      return { workspace: workspace.toLowerCase(), publicId: publicId.toLowerCase() };
    }
    return {
      workspace: workspace.toLowerCase(),
      publicId: publicId.toLowerCase(),
      token: last,
    };
  }
  return null;
}

export function publicOrderLinkApiPath(
  ref: { workspace?: string; publicId?: string; token?: string },
  action?: "submit" | "pincode"
) {
  const suffix = action ? `/${action}` : "";
  if (ref.workspace && ref.publicId) {
    if (!CUSTOMER_ORDER_WORKSPACE.test(ref.workspace) || !CUSTOMER_ORDER_PUBLIC_ID.test(ref.publicId)) {
      return null;
    }
    const query = new URLSearchParams({ workspace: ref.workspace, code: ref.publicId });
    return `/api/v1/public/order-links/${WHATSAPP_ORDER_FORM_SLUG}${suffix}?${query.toString()}`;
  }
  if (ref.token && CUSTOMER_ORDER_LINK_TOKEN.test(normalizeCustomerOrderLinkToken(ref.token))) {
    return `/api/v1/public/order-links/${normalizeCustomerOrderLinkToken(ref.token)}${suffix}`;
  }
  return null;
}

export const customerOrderLinkTokenSchema = z
  .string()
  .transform(normalizeCustomerOrderLinkToken)
  .refine((value) => CUSTOMER_ORDER_LINK_TOKEN.test(value), "This link is not valid.");

export const publicOrderLinkPathQuery = z.object({
  workspace: z
    .string()
    .trim()
    .toLowerCase()
    .regex(CUSTOMER_ORDER_WORKSPACE, "This link is not valid."),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(CUSTOMER_ORDER_PUBLIC_ID, "This link is not valid."),
});

export const customerOrderLinkListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(CUSTOMER_ORDER_LINK_STATUSES).optional(),
});

export const submitCustomerOrderLinkSchema = z.object({
  customerName: z.string().trim().min(2, "Name is required."),
  phone: z
    .string()
    .trim()
    .min(8, "Mobile number is required.")
    .refine((value) => extractIndiaMobileDigits(value) !== null, "Enter a valid 10-digit Indian mobile number."),
  line1: z.string().trim().min(3, "Address is required."),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(2, "City is required."),
  state: z.string().trim().min(2, "State is required."),
  pincode: z.string().trim().regex(/^\d{6}$/, "Enter a 6-digit PIN code."),
});

export const confirmCustomerOrderLinkSchema = z
  .object({
    paymentType: z.enum(["PREPAID", "COD"]),
    amount: z.coerce.number().positive("Enter the order amount."),
    customerName: z.string().trim().min(2).optional(),
    phone: z
      .string()
      .trim()
      .optional()
      .refine((value) => !value || extractIndiaMobileDigits(value) !== null, "Enter a valid 10-digit Indian mobile number."),
    line1: z.string().trim().min(3).optional(),
    line2: z.string().trim().optional(),
    city: z.string().trim().min(2).optional(),
    state: z.string().trim().min(2).optional(),
    pincode: z.string().trim().regex(/^\d{6}$/).optional(),
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
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.paymentType === "COD" && !(value.amount > 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Enter the COD collection amount.",
      });
    }
  });

export type SubmitCustomerOrderLinkInput = z.infer<typeof submitCustomerOrderLinkSchema>;
export type ConfirmCustomerOrderLinkInput = z.infer<typeof confirmCustomerOrderLinkSchema>;
export type CustomerOrderLinkListQuery = z.infer<typeof customerOrderLinkListQuery>;
