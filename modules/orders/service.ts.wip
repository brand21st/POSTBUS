import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { orIlike } from "@/lib/api/filters";
import type { OrderStatus } from "@/types/domain";
import type { TenantContext } from "@/lib/api/context";
import type { z } from "zod";
import type { createOrderSchema, orderListQuery, updateOrderWeightsSchema } from "@/modules/orders/schema";
import { parcelServiceCode } from "@/modules/india-post/booking-service";
import { settleOrderPayment } from "@/modules/orders/payment";
import {
  mergeWhatsappLifecycle,
  storefrontQuoteFromMetadata,
  whatsappLifecycleFromMetadata,
  whatsappPaymentRequirement,
} from "@/modules/orders/whatsapp-meta";
import {
  mapCatalogRows,
  resolveLineFromCatalog,
  resolveManualLine,
  settleResolvedOrderPayment,
  type ResolvedOrderLine,
} from "@/modules/products/order-lines";
import { loadCatalogProducts } from "@/modules/products/service";
import { bookingBoxWeightGrams } from "@/modules/orders/weight";
import { syncOpenShipmentsService } from "@/modules/shipments/service";
import {
  enrichShopifyLineItemImagesFromCache,
  enrichShopifyLineItemImagesInOrders,
} from "@/modules/shopify/orders";
import { isOrderNumberConflict, nextPbOrderNumber } from "@/modules/orders/order-number";

type CreateInput = z.infer<typeof createOrderSchema> & { status?: OrderStatus };
type OrderActor = Pick<TenantContext, "organizationId"> & { userId?: string | null };
type OrderListQuery = z.infer<typeof orderListQuery>;

const OPEN_WEIGHT_SHIPMENT_STATUSES = new Set(["DRAFT", "QUEUED", "FAILED", "CANCELLED"]);

const ORDER_LIST_SELECT =
  "id, order_number, source, status, payment_status, total_amount, currency, created_at, india_post_service, parcel_weight_mode, parcel_weight_grams, customers(name, phone), order_line_items(id, title, quantity, weight_grams, image_url), shipments(id, status, weight_grams, length_cm, width_cm, height_cm, service_code, created_at)";

function wantsOrderCounts(query: OrderListQuery) {
  const value = (query.includeCounts ?? "").toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function orderDateBoundary(value: string, endOfDay: boolean) {
  if (value.includes("T")) return value;
  return `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`;
}

async function nextOrderNumber(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase
    .from("orders")
    .select("order_number")
    .eq("organization_id", organizationId);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return nextPbOrderNumber(rows.map((row) => (row as { order_number?: string }).order_number));
}

type OrderDateRange = "list" | "none" | { from?: string; to?: string };

function applyOrderListFilters(
  // PostgREST filter builders are not exported as a stable public type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: any,
  ctx: TenantContext,
  query: OrderListQuery,
  dates: OrderDateRange = "list"
) {
  builder = builder.eq("organization_id", ctx.organizationId);
  if (query.status) builder = builder.eq("status", query.status);
  if (query.source) builder = builder.eq("source", query.source);
  if (query.paymentStatus) builder = builder.eq("payment_status", query.paymentStatus);
  const from = dates === "list" ? query.from : dates === "none" ? undefined : dates.from;
  const to = dates === "list" ? query.to : dates === "none" ? undefined : dates.to;
  if (from) builder = builder.gte("created_at", orderDateBoundary(from, false));
  if (to) builder = builder.lte("created_at", orderDateBoundary(to, true));
  if (query.q) {
    const filter = orIlike(["order_number", "source_order_id"], query.q);
    if (filter) builder = builder.or(filter);
  }
  return builder;
}

async function countOrders(
  supabase: SupabaseClient,
  ctx: TenantContext,
  query: OrderListQuery,
  dates: OrderDateRange = "list"
) {
  const builder = applyOrderListFilters(
    supabase.from("orders").select("id", { count: "exact", head: true }),
    ctx,
    query,
    dates
  );
  const { count, error } = await builder;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return count ?? 0;
}

export async function listOrders(
  supabase: SupabaseClient,
  ctx: TenantContext,
  query: OrderListQuery
) {
  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;

  const listBuilder = applyOrderListFilters(
    supabase.from("orders").select(ORDER_LIST_SELECT).order("created_at", { ascending: false }).range(from, to),
    ctx,
    query
  );

  const includeCounts = wantsOrderCounts(query);
  const [listed, total, all, today, yesterday] = await Promise.all([
    listBuilder,
    countOrders(supabase, ctx, query, "list"),
    includeCounts ? countOrders(supabase, ctx, query, "none") : Promise.resolve(0),
    includeCounts && query.todayFrom && query.todayTo
      ? countOrders(supabase, ctx, query, { from: query.todayFrom, to: query.todayTo })
      : Promise.resolve(0),
    includeCounts && query.yesterdayFrom && query.yesterdayTo
      ? countOrders(supabase, ctx, query, { from: query.yesterdayFrom, to: query.yesterdayTo })
      : Promise.resolve(0),
  ]);

  if (listed.error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, listed.error.message);

  const items = (listed.data ?? []).map(mapOrder);
  enrichShopifyLineItemImagesFromCache(supabase, ctx.organizationId, items);
  void enrichShopifyLineItemImagesInOrders(supabase, ctx.organizationId, items);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    ...(includeCounts ? { counts: { all, today, yesterday } } : {}),
  };
}

export async function getOrder(supabase: SupabaseClient, ctx: TenantContext, id: string) {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "*, customers(*), shipping_address:addresses!shipping_address_id(*), billing_address:addresses!billing_address_id(*), order_line_items(*), shipments(*), shipping_invoices(id, status, invoice_number, error_message, shipment_id, created_at)"
    )
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found.");
  const order = mapOrder(data);
  enrichShopifyLineItemImagesFromCache(supabase, ctx.organizationId, [order]);
  void enrichShopifyLineItemImagesInOrders(supabase, ctx.organizationId, [order]);
  return order;
}

export async function createManualOrder(
  supabase: SupabaseClient,
  ctx: OrderActor,
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

  const productIds = input.lineItems.map((item) => item.productId).filter((id): id is string => Boolean(id));
  const catalog = mapCatalogRows(
    (await loadCatalogProducts(supabase, ctx.organizationId, productIds)) as Array<{
      id: string;
      name: string;
      sku: string;
      price: number | string;
      weight_grams: number;
      active: boolean;
      prepaid_enabled: boolean;
      cod_enabled: boolean;
      cod_advance_percent: number | string | null;
      image_urls?: unknown;
    }>
  );
  const resolvedLines: ResolvedOrderLine[] = input.lineItems.map((item) => {
    if (!item.productId) return resolveManualLine(item);
    const product = catalog.get(item.productId);
    if (!product) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Product not found.");
    }
    return resolveLineFromCatalog(product, item.quantity);
  });
  const subtotal = resolvedLines.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const payment = settleResolvedOrderPayment({
    lines: resolvedLines,
    paymentStatus: input.paymentStatus,
    amountPaid: input.amountPaid,
  });
  const requestedNumber = input.orderNumber?.trim() || "";
  let orderNumber = requestedNumber || (await nextOrderNumber(supabase, ctx.organizationId));
  let order: Record<string, unknown> | null = null;
  let orderError: { message?: string } | null = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const inserted = await supabase
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
        payment_status: payment.paymentStatus,
        amount_paid: payment.amountPaid,
        cod_amount: payment.codAmount,
        fulfillment_status: "UNFULFILLED",
        status: input.status ?? "READY",
        metadata: input.metadata ?? {},
      })
      .select()
      .single();
    order = inserted.data as Record<string, unknown> | null;
    orderError = inserted.error;
    if (!orderError && order) break;
    if (!isOrderNumberConflict(orderError?.message)) break;
    if (requestedNumber) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "That order number already exists. Leave it blank or use a different number.");
    }
    orderNumber = await nextOrderNumber(supabase, ctx.organizationId);
  }

  if (orderError || !order) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      isOrderNumberConflict(orderError?.message)
        ? "That order number already exists. Leave it blank or use a different number."
        : orderError?.message || "Order failed."
    );
  }

  const { error: itemsError } = await supabase.from("order_line_items").insert(
    resolvedLines.map((item) => ({
      organization_id: ctx.organizationId,
      order_id: order.id,
      product_id: item.productId,
      title: item.title,
      sku: item.sku || null,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      weight_grams: item.weightGrams ?? null,
      image_url: item.imageUrl ?? null,
    }))
  );
  if (itemsError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, itemsError.message);

  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId || null,
    action: "order.created",
    entity_type: "order",
    entity_id: order.id,
    after: {
      orderNumber,
      source: input.source ?? "MANUAL",
      paymentStatus: payment.paymentStatus,
      amountPaid: payment.amountPaid,
      codAmount: payment.codAmount,
    },
  });

  try {
    const { scheduleMerchantKnowledgeSync } = await import("@/modules/vachat/knowledge");
    scheduleMerchantKnowledgeSync(supabase, ctx.organizationId);
  } catch {
    // VaChat knowledge is optional; the order should still be created.
  }

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

function preferredShipment(shipments: Array<Record<string, unknown>>) {
  const ranked = [...shipments].sort((left, right) =>
    String(right.created_at ?? "").localeCompare(String(left.created_at ?? ""))
  );
  return ranked.find((item) => String(item.status ?? "").toUpperCase() !== "CANCELLED") ?? ranked[0] ?? null;
}

export async function setOrderBookingService(
  supabase: SupabaseClient,
  ctx: TenantContext,
  orderId: string,
  serviceCode: string
) {
  const service = parcelServiceCode(serviceCode);
  if (!service) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Choose Speed Post parcel or Business Parcel.");
  }
  const { data, error } = await supabase
    .from("orders")
    .update({ india_post_service: service })
    .eq("organization_id", ctx.organizationId)
    .eq("id", orderId)
    .select("id")
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found.");

  const { data: shipments, error: shipmentError } = await supabase
    .from("shipments")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("order_id", orderId)
    .in("status", ["DRAFT", "QUEUED", "FAILED"]);
  if (shipmentError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, shipmentError.message);
  await syncOpenShipmentsService(
    supabase,
    ctx.organizationId,
    (shipments ?? []).map((item) => item.id as string),
    service
  );
  return { id: orderId, indiaPostService: service };
}

export async function updateOrderWeights(
  supabase: SupabaseClient,
  ctx: TenantContext,
  orderId: string,
  input: z.infer<typeof updateOrderWeightsSchema>
) {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, orderError.message);
  if (!order) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found.");

  const { data: shipments, error: shipmentError } = await supabase
    .from("shipments")
    .select("id, status")
    .eq("organization_id", ctx.organizationId)
    .eq("order_id", orderId);
  if (shipmentError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, shipmentError.message);
  const shipmentRows = (shipments ?? []) as Array<{ id: string; status?: string | null }>;
  const locked = shipmentRows.some((row) => !OPEN_WEIGHT_SHIPMENT_STATUSES.has((row.status ?? "").toUpperCase()));
  if (locked) {
    throw new AppError(ERROR_CODES.CONFLICT, "Weight is locked after India Post booking.");
  }

  const { data: lines, error: lineError } = await supabase
    .from("order_line_items")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("order_id", orderId);
  if (lineError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, lineError.message);
  const lineIds = new Set((lines ?? []).map((row) => row.id as string));
  for (const item of input.lineItems) {
    if (!lineIds.has(item.id)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "One of the products is not on this order.");
    }
  }

  for (const item of input.lineItems) {
    const { error } = await supabase
      .from("order_line_items")
      .update({
        weight_grams: item.weightGrams > 0 ? item.weightGrams : null,
        weight_edited: (item.weightMode ?? "manual") === "manual",
      })
      .eq("organization_id", ctx.organizationId)
      .eq("order_id", orderId)
      .eq("id", item.id);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }

  const parcelWeightGrams = input.parcelWeightMode === "manual" ? input.parcelWeightGrams ?? null : null;
  const { error: weightError } = await supabase
    .from("orders")
    .update({
      parcel_weight_mode: input.parcelWeightMode,
      parcel_weight_grams: parcelWeightGrams,
    })
    .eq("organization_id", ctx.organizationId)
    .eq("id", orderId);
  if (weightError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, weightError.message);

  const boxWeight = bookingBoxWeightGrams({
    parcelWeightMode: input.parcelWeightMode,
    parcelWeightGrams,
    lineItems: input.lineItems,
  });
  const openIds = shipmentRows
    .filter((row) => ["DRAFT", "QUEUED", "FAILED"].includes((row.status ?? "").toUpperCase()))
    .map((row) => row.id);
  if (openIds.length) {
    const { error } = await supabase
      .from("shipments")
      .update({ weight_grams: boxWeight })
      .eq("organization_id", ctx.organizationId)
      .in("id", openIds);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }

  return getOrder(supabase, ctx, orderId);
}

function mapOrder(row: Record<string, unknown>) {
  const customer = row.customers as { name?: string; phone?: string; email?: string } | null;
  const items = (row.order_line_items as Array<Record<string, unknown>> | undefined) ?? [];
  const shipments = (row.shipments as Array<Record<string, unknown>> | undefined) ?? [];
  const invoicesRaw = row.shipping_invoices;
  const invoices = Array.isArray(invoicesRaw)
    ? invoicesRaw
    : invoicesRaw && typeof invoicesRaw === "object"
      ? [invoicesRaw as Record<string, unknown>]
      : [];
  return {
    ...row,
    orderNumber: row.order_number,
    paymentStatus: row.payment_status,
    fulfillmentStatus: row.fulfillment_status,
    totalAmount: row.total_amount,
    amountPaid: row.amount_paid,
    amount_paid: row.amount_paid,
    codAmount: row.cod_amount,
    cod_amount: row.cod_amount,
    createdAt: row.created_at,
    indiaPostService: row.india_post_service ?? null,
    parcelWeightMode: row.parcel_weight_mode ?? "auto",
    parcelWeightGrams: row.parcel_weight_grams ?? null,
    customer: customer
      ? { name: customer.name, phone: customer.phone, email: customer.email }
      : null,
    customerName: customer?.name ?? null,
    lineItems: items.map((item) => ({
      ...item,
      imageUrl: (item.imageUrl ?? item.image_url) as string | null,
      image_url: (item.image_url ?? item.imageUrl) as string | null,
    })),
    items: items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0),
    shipment: preferredShipment(shipments),
    invoice: invoices[0]
      ? {
          id: invoices[0].id,
          status: invoices[0].status,
          invoiceNumber: invoices[0].invoice_number,
          invoice_number: invoices[0].invoice_number,
          errorMessage: invoices[0].error_message,
        }
      : null,
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

export async function confirmWhatsAppOrder(
  supabase: SupabaseClient,
  ctx: TenantContext,
  orderId: string,
  input: {
    paymentType: "PREPAID" | "COD";
    amount: number;
    customerName?: string;
    phone?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    pincode?: string;
    lineItems?: Array<{ title: string; sku?: string; quantity: number; unitPrice: number; weightGrams?: number }>;
  }
) {
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, source, status, payment_status, customer_id, shipping_address_id, metadata, total_amount")
    .eq("organization_id", ctx.organizationId)
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!order) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found.");
  if (order.source !== "WHATSAPP") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This is not a WhatsApp order.");
  }
  const life = whatsappLifecycleFromMetadata(order.metadata);
  if (!life.customer_confirmed_at) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Customer has not confirmed this WhatsApp order.");
  }
  if (order.status !== "IMPORTED" || order.payment_status !== "PENDING") {
    throw new AppError(ERROR_CODES.CONFLICT, "This WhatsApp order has already been confirmed.");
  }

  const { data: existingLines } = await supabase
    .from("order_line_items")
    .select("id, product_id, title, sku, quantity, unit_price, weight_grams, image_url")
    .eq("organization_id", ctx.organizationId)
    .eq("order_id", orderId);
  const catalogLines = (existingLines ?? []).filter((line) => line.product_id);
  const keepCatalog = catalogLines.length > 0;

  const lineItems =
    keepCatalog
      ? catalogLines.map((line) => ({
          productId: String(line.product_id),
          title: String(line.title),
          sku: (line.sku as string | null) ?? undefined,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unit_price),
          weightGrams: line.weight_grams == null ? undefined : Number(line.weight_grams),
        }))
      : input.lineItems && input.lineItems.length > 0
        ? input.lineItems
        : [{ title: "WhatsApp order", quantity: 1, unitPrice: Number(order.total_amount ?? 0) }];

  const subtotal = lineItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const quoteTotal = Number(storefrontQuoteFromMetadata(order.metadata).total || order.total_amount || subtotal);
  const pay = whatsappPaymentRequirement(order.metadata, quoteTotal);
  const now = new Date().toISOString();

  if (pay.required) {
    if (!life.merchant_processed_at) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Process this WhatsApp order before confirming payment.");
    }
    const payment =
      pay.preference === "PREPAID" || (pay.amount >= quoteTotal && quoteTotal > 0)
        ? settleOrderPayment({ paymentStatus: "PAID", totalAmount: quoteTotal })
        : settleOrderPayment({
            paymentStatus: "PARTIAL",
            totalAmount: quoteTotal,
            amountPaid: pay.amount,
          });
    const { data: resolved, error: rpcError } = await supabase.rpc("resolve_whatsapp_payment_claim", {
      p_action: "CONFIRM",
      p_order_id: orderId,
      p_organization_id: ctx.organizationId,
      p_payment_status: payment.paymentStatus,
      p_amount_paid: payment.amountPaid,
      p_cod_amount: payment.codAmount,
      p_metadata: mergeWhatsappLifecycle(order.metadata, {
        merchant_accepted_at: life.merchant_accepted_at ?? now,
        merchant_accepted_via: life.merchant_accepted_via ?? "dashboard",
      }),
    });
    if (rpcError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, rpcError.message);
    const result = String((resolved as { result?: string } | null)?.result ?? "");
    if (result === "no_open_claim") {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Customer has not submitted a payment claim yet.");
    }
    if (result !== "confirmed") {
      throw new AppError(ERROR_CODES.CONFLICT, "This WhatsApp order has already been confirmed.");
    }
    const { data: updated } = await supabase
      .from("orders")
      .select()
      .eq("id", orderId)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (!updated) throw new AppError(ERROR_CODES.CONFLICT, "This WhatsApp order has already been confirmed.");
    await supabase.from("audit_logs").insert({
      organization_id: ctx.organizationId,
      actor_id: ctx.userId || null,
      action: "order.whatsapp_confirmed",
      entity_type: "order",
      entity_id: orderId,
      after: { via: "dashboard", settledFromQuote: true },
    });
    return updated;
  }

  const payment = settleOrderPayment({
    paymentStatus: "COD",
    totalAmount: quoteTotal || subtotal,
  });

  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({
      subtotal: quoteTotal || subtotal,
      total_amount: quoteTotal || subtotal,
      payment_status: payment.paymentStatus,
      amount_paid: payment.amountPaid,
      cod_amount: payment.codAmount,
      status: "READY",
      metadata: mergeWhatsappLifecycle(order.metadata, {
        merchant_processed_at: life.merchant_processed_at ?? now,
        merchant_accepted_at: life.merchant_accepted_at ?? now,
        merchant_accepted_via: life.merchant_accepted_via ?? "dashboard",
        payment_required: false,
        payment_required_amount: 0,
      }),
    })
    .eq("id", orderId)
    .eq("organization_id", ctx.organizationId)
    .eq("source", "WHATSAPP")
    .eq("status", "IMPORTED")
    .eq("payment_status", "PENDING")
    .select()
    .maybeSingle();
  if (updateError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, updateError.message);
  if (!updated) throw new AppError(ERROR_CODES.CONFLICT, "This WhatsApp order has already been confirmed.");

  if (!keepCatalog) {
    await supabase.from("order_line_items").delete().eq("order_id", orderId).eq("organization_id", ctx.organizationId);
    const { error: itemsError } = await supabase.from("order_line_items").insert(
      lineItems.map((item) => ({
        organization_id: ctx.organizationId,
        order_id: orderId,
        title: item.title,
        sku: item.sku || null,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        weight_grams: item.weightGrams ?? null,
      }))
    );
    if (itemsError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, itemsError.message);
  }

  if (order.customer_id && (input.customerName || input.phone)) {
    await supabase
      .from("customers")
      .update({
        ...(input.customerName ? { name: input.customerName.trim() } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
      })
      .eq("id", order.customer_id)
      .eq("organization_id", ctx.organizationId);
  }
  if (order.shipping_address_id && (input.line1 || input.city || input.state || input.pincode)) {
    await supabase
      .from("addresses")
      .update({
        ...(input.customerName ? { name: input.customerName.trim() } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        ...(input.line1 ? { line1: input.line1.trim() } : {}),
        ...(input.line2 !== undefined ? { line2: input.line2?.trim() || null } : {}),
        ...(input.city ? { city: input.city.trim() } : {}),
        ...(input.state ? { state: input.state.trim() } : {}),
        ...(input.pincode ? { pincode: input.pincode.trim() } : {}),
      })
      .eq("id", order.shipping_address_id)
      .eq("organization_id", ctx.organizationId);
  }

  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId || null,
    action: "order.whatsapp_confirmed",
    entity_type: "order",
    entity_id: orderId,
    after: { paymentType: input.paymentType, amount: input.amount },
  });

  return updated;
}
