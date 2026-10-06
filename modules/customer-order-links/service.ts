import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { env } from "@/lib/env";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { hashSecret } from "@/lib/security/crypto";
import { createCustomerOrderLinkToken } from "@/modules/customer-order-links/token";
import { createOrderSchema } from "@/modules/orders/schema";
import { confirmWhatsAppOrder, createManualOrder } from "@/modules/orders/service";
import {
  customerOrderLinkPath,
  customerOrderWorkspaceSlug,
  type ConfirmCustomerOrderLinkInput,
} from "@/modules/customer-order-links/schema";
import {
  hashedCustomerOrderPublicId,
  isCustomerOrderPublicId,
} from "@/modules/customer-order-links/public-id";

const LINK_SELECT =
  "id, organization_id, status, expires_at, public_workspace, public_code, customer_name, phone, line1, line2, city, state, pincode, opened_at, submitted_at, confirmed_at, disabled_at, order_id, created_at, updated_at";

type LinkRow = {
  id: string;
  organization_id: string;
  status: string;
  expires_at: string | null;
  public_workspace: string | null;
  public_code: string | null;
  customer_name: string | null;
  phone: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  opened_at: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  disabled_at: string | null;
  order_id: string | null;
  created_at: string;
  updated_at: string;
};

function publicLinkUrl(workspace: string, publicId: string) {
  return `${env.appUrl.replace(/\/$/, "")}${customerOrderLinkPath(workspace, publicId)}`;
}

async function uniquePublicCode(supabase: SupabaseClient, organizationId: string) {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const code = hashedCustomerOrderPublicId(organizationId, attempt);
    const { data } = await supabase
      .from("customer_order_links")
      .select("id, organization_id")
      .eq("public_code", code)
      .limit(1)
      .maybeSingle();
    if (!data || data.organization_id === organizationId) return code;
  }
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not allocate a public order link id.");
}

async function uniqueWorkspace(
  supabase: SupabaseClient,
  organizationId: string,
  preferred: string
) {
  let candidate = preferred;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data } = await supabase
      .from("customer_order_links")
      .select("id, organization_id")
      .eq("status", "ACTIVE")
      .eq("public_workspace", candidate)
      .limit(1)
      .maybeSingle();
    if (!data || data.organization_id === organizationId) return candidate;
    candidate = `${preferred.slice(0, 40)}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${preferred}-${randomUUID().replace(/-/g, "").slice(0, 4)}`;
}

export async function getMerchantCollectionLink(supabase: SupabaseClient, ctx: TenantContext) {
  const { data: existing } = await supabase
    .from("customer_order_links")
    .select(LINK_SELECT)
    .eq("organization_id", ctx.organizationId)
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.public_workspace) {
    const workspace = existing.public_workspace as string;
    const publicId = isCustomerOrderPublicId(existing.public_code as string | null)
      ? (existing.public_code as string)
      : await uniquePublicCode(supabase, ctx.organizationId);
    if (publicId !== existing.public_code) {
      await supabase
        .from("customer_order_links")
        .update({ public_code: publicId })
        .eq("id", existing.id);
    }
    return {
      id: existing.id as string,
      slug: workspace,
      publicId,
      url: publicLinkUrl(workspace, publicId),
      status: "ACTIVE" as const,
    };
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("slug, name")
    .eq("id", ctx.organizationId)
    .maybeSingle();

  const workspace = await uniqueWorkspace(
    supabase,
    ctx.organizationId,
    customerOrderWorkspaceSlug(
      (organization?.name as string | undefined) || ctx.organizationName,
      organization?.slug as string | null | undefined
    )
  );

  const publicId = await uniquePublicCode(supabase, ctx.organizationId);

  if (existing) {
    await supabase
      .from("customer_order_links")
      .update({
        status: "ACTIVE",
        public_workspace: workspace,
        public_code: publicId,
        expires_at: null,
        disabled_at: null,
      })
      .eq("id", existing.id);
    return {
      id: existing.id as string,
      slug: workspace,
      publicId,
      url: publicLinkUrl(workspace, publicId),
      status: "ACTIVE" as const,
    };
  }

  const id = randomUUID();
  const token = createCustomerOrderLinkToken();
  const { data, error } = await supabase
    .from("customer_order_links")
    .insert({
      id,
      organization_id: ctx.organizationId,
      created_by: ctx.userId,
      token_hash: hashSecret(token.toLowerCase()),
      public_workspace: workspace,
      public_code: publicId,
      status: "ACTIVE",
      expires_at: null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not create the customer link.");
  }

  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "customer_order_link.created",
    entity_type: "customer_order_link",
    entity_id: data.id,
  });

  return {
    id: data.id as string,
    slug: workspace,
    publicId,
    url: publicLinkUrl(workspace, publicId),
    status: "ACTIVE" as const,
  };
}

export async function listWhatsAppPendingOrders(supabase: SupabaseClient, ctx: TenantContext) {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_number, source, status, payment_status, total_amount, amount_paid, cod_amount, metadata, created_at, customers(name, phone), addresses:shipping_address_id(line1, line2, city, state, pincode)"
    )
    .eq("organization_id", ctx.organizationId)
    .eq("source", "WHATSAPP")
    .eq("status", "IMPORTED")
    .eq("payment_status", "PENDING")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

  return (data ?? []).map((row) => {
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
    const address = Array.isArray(row.addresses) ? row.addresses[0] : row.addresses;
    const metadata = (row.metadata ?? {}) as {
      storefront?: { paymentPreference?: string; expectedAdvance?: number; amountOnDelivery?: number; total?: number };
    };
    return {
      id: row.id as string,
      orderNumber: row.order_number as string,
      customerName: (customer as { name?: string } | null)?.name ?? null,
      phone: (customer as { phone?: string } | null)?.phone ?? null,
      line1: (address as { line1?: string } | null)?.line1 ?? null,
      line2: (address as { line2?: string } | null)?.line2 ?? null,
      city: (address as { city?: string } | null)?.city ?? null,
      state: (address as { state?: string } | null)?.state ?? null,
      pincode: (address as { pincode?: string } | null)?.pincode ?? null,
      createdAt: row.created_at as string,
      totalAmount: Number(row.total_amount ?? 0),
      paymentPreference: metadata.storefront?.paymentPreference ?? null,
      expectedAdvance: metadata.storefront?.expectedAdvance ?? 0,
      amountOnDelivery: metadata.storefront?.amountOnDelivery ?? 0,
    };
  });
}

export async function confirmWhatsAppCollectionOrder(
  supabase: SupabaseClient,
  ctx: TenantContext,
  orderId: string,
  input: ConfirmCustomerOrderLinkInput
) {
  const phone = input.phone ? extractIndiaMobileDigits(input.phone) ?? input.phone : input.phone;
  return confirmWhatsAppOrder(supabase, ctx, orderId, {
    ...input,
    phone: phone ?? undefined,
    lineItems:
      input.lineItems && input.lineItems.length > 0
        ? input.lineItems
        : [{ title: "WhatsApp order", quantity: 1, unitPrice: input.amount }],
  });
}

/** Legacy one-time submissions that were never confirmed. */
export async function listLegacySubmissions(supabase: SupabaseClient, ctx: TenantContext) {
  const { data, error } = await supabase
    .from("customer_order_links")
    .select(LINK_SELECT)
    .eq("organization_id", ctx.organizationId)
    .eq("status", "SUBMITTED")
    .order("submitted_at", { ascending: false })
    .limit(50);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return ((data ?? []) as LinkRow[]).map((row) => ({
    id: row.id,
    customerName: row.customer_name,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    submittedAt: row.submitted_at,
  }));
}

export async function confirmLegacyCustomerOrderLink(
  supabase: SupabaseClient,
  ctx: TenantContext,
  id: string,
  input: ConfirmCustomerOrderLinkInput
) {
  const { data: link, error } = await supabase
    .from("customer_order_links")
    .select(LINK_SELECT)
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!link) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Submission not found.");
  const row = link as LinkRow;
  if (row.status !== "SUBMITTED") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This submission is no longer waiting for confirmation.");
  }

  const phone = extractIndiaMobileDigits(input.phone ?? row.phone ?? "") ?? input.phone ?? row.phone;
  const customerName = (input.customerName ?? row.customer_name)?.trim() || null;
  const line1 = (input.line1 ?? row.line1)?.trim() || null;
  const city = (input.city ?? row.city)?.trim() || null;
  const state = (input.state ?? row.state)?.trim() || null;
  const pincode = (input.pincode ?? row.pincode)?.trim() || null;
  if (!customerName || !phone || !line1 || !city || !state || !pincode) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Customer details are incomplete.");
  }

  const orderInput = createOrderSchema.parse({
    source: "WHATSAPP",
    paymentStatus: input.paymentType === "COD" ? "COD" : "PAID",
    customer: { name: customerName, phone },
    shippingAddress: {
      name: customerName,
      phone,
      line1,
      line2: (input.line2 ?? row.line2)?.trim() || undefined,
      city,
      state,
      pincode,
      country: "IN",
    },
    billingSameAsShipping: true,
    lineItems:
      input.lineItems && input.lineItems.length > 0
        ? input.lineItems
        : [{ title: "WhatsApp order", quantity: 1, unitPrice: input.amount }],
  });
  const order = await createManualOrder(supabase, ctx, { ...orderInput, status: "READY" });

  await supabase
    .from("customer_order_links")
    .update({
      status: "CONFIRMED",
      confirmed_at: new Date().toISOString(),
      order_id: order.id,
    })
    .eq("id", id)
    .eq("organization_id", ctx.organizationId);

  return { order };
}
