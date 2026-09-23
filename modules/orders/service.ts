import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { orIlike } from "@/lib/api/filters";
import type { TenantContext } from "@/lib/api/context";
import type { z } from "zod";
import type { createOrderSchema, orderListQuery } from "@/modules/orders/schema";

type CreateInput = z.infer<typeof createOrderSchema>;

function orderDateBoundary(value: string, endOfDay: boolean) {
  if (value.includes("T")) return value;
  return `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`;
}

async function nextOrderNumber(supabase: SupabaseClient, organizationId: string) {
  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  return `PB-${String((count ?? 0) + 10001)}`;
}

export async function listOrders(
  supabase: SupabaseClient,
  ctx: TenantContext,
  query: z.infer<typeof orderListQuery>
) {
  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;

  let builder = supabase
    .from("orders")
    .select(
      "*, customers(id, name, phone, email), order_line_items(id, title, sku, quantity, unit_price), shipments(id, status, barcode, tracking_number)",
      { count: "exact" }
    )
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (query.status) builder = builder.eq("status", query.status);
  if (query.source) builder = builder.eq("source", query.source);
  if (query.paymentStatus) builder = builder.eq("payment_status", query.paymentStatus);
  if (query.from) builder = builder.gte("created_at", orderDateBoundary(query.from, false));
  if (query.to) builder = builder.lte("created_at", orderDateBoundary(query.to, true));
  if (query.q) {
    const filter = orIlike(["order_number", "source_order_id"], query.q);
    if (filter) builder = builder.or(filter);
  }

  const { data, error, count } = await builder;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

  const items = (data ?? []).map(mapOrder);
  return { items, page: query.page, pageSize: query.pageSize, total: count ?? 0 };
}

export async function getOrder(supabase: SupabaseClient, ctx: TenantContext, id: string) {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "*, customers(*), shipping_address:addresses!shipping_address_id(*), billing_address:addresses!billing_address_id(*), order_line_items(*), shipments(*)"
    )
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found.");
  return mapOrder(data);
}

export async function createManualOrder(
  supabase: SupabaseClient,
  ctx: TenantContext,
  input: CreateInput
) {
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .insert({
      organization_id: ctx.organizationId,
      name: input.customer.name,
      phone: input.customer.phone,
      email: input.customer.email || null,
    })
    .select()
    .single();
  if (customerError || !customer) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, customerError?.message || "Customer failed.");
  }

  const shipping = await insertAddress(supabase, ctx.organizationId, customer.id, input.shippingAddress);
  const billing =
    input.billingSameAsShipping !== false || !input.billingAddress
      ? shipping
      : await insertAddress(supabase, ctx.organizationId, customer.id, input.billingAddress);

  const subtotal = input.lineItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const orderNumber = input.orderNumber?.trim() || (await nextOrderNumber(supabase, ctx.organizationId));

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      organization_id: ctx.organizationId,
      source: input.source ?? "MANUAL",
      order_number: orderNumber,
      customer_id: customer.id,
      shipping_address_id: shipping.id,
      billing_address_id: billing.id,
      subtotal,
      total_amount: subtotal,
      payment_status: input.paymentStatus ?? "PENDING",
      fulfillment_status: "UNFULFILLED",
      status: "READY",
    })
    .select()
    .single();

  if (orderError || !order) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, orderError?.message || "Order failed.");
  }

  const { error: itemsError } = await supabase.from("order_line_items").insert(
    input.lineItems.map((item) => ({
      organization_id: ctx.organizationId,
      order_id: order.id,
      title: item.title,
      sku: item.sku || null,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      weight_grams: item.weightGrams ?? null,
    }))
  );
  if (itemsError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, itemsError.message);

  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "order.created",
    entity_type: "order",
    entity_id: order.id,
    after: { orderNumber, source: "MANUAL" },
  });

  return { ...order, createShipment: Boolean(input.createShipment), shipment: input.shipment };
}

function insertAddress(
  supabase: SupabaseClient,
  organizationId: string,
  customerId: string,
  address: CreateInput["shippingAddress"]
) {
  return supabase
    .from("addresses")
    .insert({
      organization_id: organizationId,
      customer_id: customerId,
      kind: "shipping",
      name: address.name ?? null,
      phone: address.phone ?? null,
      line1: address.line1,
      line2: address.line2 ?? null,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      country: address.country ?? "IN",
    })
    .select()
    .single()
    .then(({ data, error }) => {
      if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Address failed.");
      return data;
    });
}

function mapOrder(row: Record<string, unknown>) {
  const customer = row.customers as { name?: string; phone?: string; email?: string } | null;
  const items = (row.order_line_items as Array<Record<string, unknown>> | undefined) ?? [];
  const shipments = (row.shipments as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    ...row,
    orderNumber: row.order_number,
    paymentStatus: row.payment_status,
    fulfillmentStatus: row.fulfillment_status,
    totalAmount: row.total_amount,
    createdAt: row.created_at,
    customer: customer
      ? { name: customer.name, phone: customer.phone, email: customer.email }
      : null,
    customerName: customer?.name ?? null,
    lineItems: items,
    items: items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0),
    shipment: shipments[0] ?? null,
    shippingAddress:
      (row.shipping_address as Record<string, unknown> | null) ??
      (row.addresses as Record<string, unknown> | null) ??
      null,
    billingAddress: (row.billing_address as Record<string, unknown> | null) ?? null,
  };
}

export async function exportOrdersCsv(
  supabase: SupabaseClient,
  ctx: TenantContext,
  query: z.infer<typeof orderListQuery>
) {
  let builder = supabase
    .from("orders")
    .select("order_number, source, status, total_amount, payment_status, created_at, customers(name)")
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (query.status) builder = builder.eq("status", query.status);
  if (query.source) builder = builder.eq("source", query.source);
  if (query.paymentStatus) builder = builder.eq("payment_status", query.paymentStatus);
  if (query.from) builder = builder.gte("created_at", orderDateBoundary(query.from, false));
  if (query.to) builder = builder.lte("created_at", orderDateBoundary(query.to, true));
  if (query.q) {
    const filter = orIlike(["order_number", "source_order_id"], query.q);
    if (filter) builder = builder.or(filter);
  }
  const { data, error } = await builder;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const header = "order_number,source,status,total_amount,payment_status,customer,created_at";
  const lines = (data ?? []).map((row) => {
    const customer = row.customers as { name?: string } | null;
    return [
      row.order_number,
      row.source,
      row.status,
      row.total_amount,
      row.payment_status,
      customer?.name ?? "",
      row.created_at,
    ]
      .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
      .join(",");
  });
  return [header, ...lines].join("\n");
}
