import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { env } from "@/lib/env";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { hashSecret } from "@/lib/security/crypto";
import { createCustomerOrderLinkToken } from "@/modules/customer-order-links/token";
import { createOrderSchema } from "@/modules/orders/schema";
import { createManualOrder } from "@/modules/orders/service";
import {
  customerOrderLinkPath,
  customerOrderLinkPublicId,
  customerOrderWorkspaceSlug,
  type ConfirmCustomerOrderLinkInput,
  type CustomerOrderLinkListQuery,
} from "@/modules/customer-order-links/schema";
import type { CustomerOrderLinkStatus } from "@/types/domain";

const LINK_SELECT =
  "id, organization_id, status, expires_at, customer_name, phone, line1, line2, city, state, pincode, opened_at, submitted_at, confirmed_at, disabled_at, order_id, created_at, updated_at, orders(order_number)";

type LinkRow = {
  id: string;
  organization_id: string;
  status: CustomerOrderLinkStatus;
  expires_at: string;
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
  orders?: { order_number?: string | null } | { order_number?: string | null }[] | null;
};

function publicLinkUrl(workspace: string, publicId: string) {
  return `${env.appUrl.replace(/\/$/, "")}${customerOrderLinkPath(workspace, publicId)}`;
}

function displayStatus(row: Pick<LinkRow, "status" | "expires_at">): CustomerOrderLinkStatus {
  if (row.status === "DISABLED" || row.status === "CONFIRMED" || row.status === "SUBMITTED") {
    return row.status;
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) return "EXPIRED";
  return row.status;
}

function orderNumberFrom(row: LinkRow) {
  const related = row.orders;
  if (Array.isArray(related)) return related[0]?.order_number ?? null;
  return related?.order_number ?? null;
}

export function mapCustomerOrderLink(row: LinkRow) {
  return {
    id: row.id,
    status: displayStatus(row),
    expiresAt: row.expires_at,
    customerName: row.customer_name,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    openedAt: row.opened_at,
    submittedAt: row.submitted_at,
    confirmedAt: row.confirmed_at,
    disabledAt: row.disabled_at,
    orderId: row.order_id,
    orderNumber: orderNumberFrom(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createCustomerOrderLink(supabase: SupabaseClient, ctx: TenantContext) {
  const { data: organization } = await supabase
    .from("organizations")
    .select("slug, name")
    .eq("id", ctx.organizationId)
    .maybeSingle();

  const workspace = customerOrderWorkspaceSlug(
    (organization?.name as string | undefined) || ctx.organizationName,
    organization?.slug as string | null | undefined
  );

  const id = randomUUID();
  const publicId = customerOrderLinkPublicId(id);
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
      status: "CREATED",
    })
    .select("id, expires_at")
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
    url: publicLinkUrl(workspace, publicId),
    expiresAt: data.expires_at as string,
  };
}

export async function listCustomerOrderLinks(
  supabase: SupabaseClient,
  ctx: TenantContext,
  query: CustomerOrderLinkListQuery
) {
  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;
  let builder = supabase
    .from("customer_order_links")
    .select(LINK_SELECT, { count: "exact" })
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (query.status) builder = builder.eq("status", query.status);

  const { data, error, count } = await builder;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

  return {
    items: ((data ?? []) as LinkRow[]).map(mapCustomerOrderLink),
    page: query.page,
    pageSize: query.pageSize,
    total: count ?? 0,
  };
}

async function getOrgLink(supabase: SupabaseClient, ctx: TenantContext, id: string) {
  const { data, error } = await supabase
    .from("customer_order_links")
    .select(LINK_SELECT)
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Customer link not found.");
  return data as LinkRow;
}

export async function disableCustomerOrderLink(supabase: SupabaseClient, ctx: TenantContext, id: string) {
  const existing = await getOrgLink(supabase, ctx, id);
  const current = displayStatus(existing);
  if (current === "CONFIRMED") {
    throw new AppError(ERROR_CODES.CONFLICT, "This submission has already been confirmed as an order.");
  }
  if (current === "DISABLED") {
    return mapCustomerOrderLink({ ...existing, status: "DISABLED" });
  }

  const { data, error } = await supabase
    .from("customer_order_links")
    .update({
      status: "DISABLED",
      disabled_at: new Date().toISOString(),
    })
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .select(LINK_SELECT)
    .single();

  if (error || !data) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not disable the link.");
  }

  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "customer_order_link.disabled",
    entity_type: "customer_order_link",
    entity_id: id,
  });

  return mapCustomerOrderLink(data as LinkRow);
}

export async function confirmCustomerOrderLink(
  supabase: SupabaseClient,
  ctx: TenantContext,
  id: string,
  input: ConfirmCustomerOrderLinkInput
) {
  const link = await getOrgLink(supabase, ctx, id);
  if (displayStatus(link) === "EXPIRED") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This link has expired.");
  }
  if (link.status === "DISABLED") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This link is disabled.");
  }
  if (link.status === "CONFIRMED" && link.order_id) {
    throw new AppError(ERROR_CODES.CONFLICT, "This submission has already been confirmed as an order.");
  }
  if (link.status !== "SUBMITTED") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "The customer has not submitted details yet.");
  }

  const phone = extractIndiaMobileDigits(input.phone ?? link.phone ?? "") ?? input.phone ?? link.phone;
  const customerName = (input.customerName ?? link.customer_name)?.trim() || null;
  const line1 = (input.line1 ?? link.line1)?.trim() || null;
  const line2 = (input.line2 ?? link.line2)?.trim() || null;
  const city = (input.city ?? link.city)?.trim() || null;
  const state = (input.state ?? link.state)?.trim() || null;
  const pincode = (input.pincode ?? link.pincode)?.trim() || null;
  if (!customerName || !phone || !line1 || !city || !state || !pincode) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Customer details are incomplete.");
  }

  const lineItems =
    input.lineItems && input.lineItems.length > 0
      ? input.lineItems
      : [{ title: "Manual order", quantity: 1, unitPrice: input.amount }];

  const paymentStatus = input.paymentType === "COD" ? "COD" : "PAID";

  const orderInput = createOrderSchema.parse({
    source: "MANUAL",
    paymentStatus,
    customer: { name: customerName, phone },
    shippingAddress: {
      name: customerName,
      phone,
      line1,
      line2: line2 || undefined,
      city,
      state,
      pincode,
      country: "IN",
    },
    billingSameAsShipping: true,
    lineItems,
  });
  const order = await createManualOrder(supabase, ctx, orderInput);

  const { data: updated, error } = await supabase
    .from("customer_order_links")
    .update({
      status: "CONFIRMED",
      confirmed_at: new Date().toISOString(),
      order_id: order.id,
    })
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .eq("status", "SUBMITTED")
    .select(LINK_SELECT)
    .maybeSingle();

  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "customer_order_link.confirmed",
    entity_type: "customer_order_link",
    entity_id: id,
    after: {
      orderId: order.id,
      paymentType: input.paymentType,
      amount: input.amount,
    },
  });

  return {
    link: mapCustomerOrderLink((updated as LinkRow | null) ?? { ...link, status: "CONFIRMED", order_id: order.id }),
    order,
  };
}
