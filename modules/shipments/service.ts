import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { orIlike } from "@/lib/api/filters";
import type { TenantContext } from "@/lib/api/context";
import { createBackgroundJob } from "@/modules/jobs/service";
import { resolveDefaultServiceCode } from "@/modules/india-post/contracts";
import { INDIA_POST_SERVICES } from "@/types/domain";

export async function createShipmentsForOrders(
  supabase: SupabaseClient,
  ctx: TenantContext,
  orderIds: string[],
  extras?: {
    weightGrams?: number;
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
    serviceCode?: string;
    enqueueBooking?: boolean;
  }
) {
  if (!orderIds.length) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Select at least one order.");
  }

  const { data: orders, error } = await supabase
    .from("orders")
    .select("*, order_line_items(quantity, weight_grams, unit_price)")
    .eq("organization_id", ctx.organizationId)
    .in("id", orderIds);

  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!orders?.length) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Orders not found.");

  // A second Ship click would otherwise consume another barcode and book a
  // second article with India Post for the same order.
  const { data: existing } = await supabase
    .from("shipments")
    .select("order_id")
    .eq("organization_id", ctx.organizationId)
    .in("order_id", orders.map((order) => order.id))
    .not("status", "in", "(CANCELLED,FAILED)");
  const alreadyShipping = new Set((existing ?? []).map((row) => row.order_id as string));

  const serviceCode = extras?.serviceCode?.trim() || (await resolveDefaultServiceCode(supabase, ctx.organizationId));
  if (!INDIA_POST_SERVICES.some((service) => service.code === serviceCode)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `${serviceCode} is not a service India Post accepts.`
    );
  }

  const created = [];
  const skipped = [];
  for (const order of orders) {
    if (alreadyShipping.has(order.id)) {
      skipped.push(order.id);
      continue;
    }

    const items = (order.order_line_items as Array<{ quantity: number; weight_grams?: number }>) ?? [];
    const weight =
      extras?.weightGrams ||
      items.reduce((sum, item) => sum + (item.weight_grams || 100) * item.quantity, 0) ||
      100;

    const { data: shipment, error: shipError } = await supabase
      .from("shipments")
      .insert({
        organization_id: ctx.organizationId,
        order_id: order.id,
        customer_id: order.customer_id,
        shipping_address_id: order.shipping_address_id,
        service_code: serviceCode,
        payment_mode: order.payment_status === "COD" ? "COD" : "PREPAID",
        weight_grams: weight,
        length_cm: extras?.lengthCm ?? null,
        width_cm: extras?.widthCm ?? null,
        height_cm: extras?.heightCm ?? null,
        status: extras?.enqueueBooking === false ? "DRAFT" : "QUEUED",
      })
      .select()
      .single();

    if (shipError || !shipment) {
      throw new AppError(ERROR_CODES.SHIPMENT_FAILED, shipError?.message || "Shipment create failed.");
    }

    await supabase.from("orders").update({ status: "PROCESSING" }).eq("id", order.id);

    if (extras?.enqueueBooking === false) {
      created.push({ ...shipment, jobId: null });
      continue;
    }

    const job = await createBackgroundJob(supabase, {
      organizationId: ctx.organizationId,
      jobType: "shipment-booking",
      entityType: "shipment",
      entityId: shipment.id,
      userId: ctx.userId,
    });

    created.push({ ...shipment, jobId: job.id });
  }

  if (!created.length && skipped.length) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      skipped.length === 1
        ? "This order already has a shipment. Open the shipment to retry or cancel it."
        : "Every selected order already has a shipment."
    );
  }

  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "shipment.created",
    entity_type: "shipment",
    after: { count: created.length, orderIds, skipped },
  });

  return { queued: created.length, skipped, shipments: created };
}

export async function listShipments(
  supabase: SupabaseClient,
  ctx: TenantContext,
  query: {
    page: number;
    pageSize: number;
    q?: string;
    status?: string;
    orderId?: string;
    serviceCode?: string;
  }
) {
  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;
  let builder = supabase
    .from("shipments")
    .select("*, orders(order_number), customers(name, phone), labels(id, status, file_url)", {
      count: "exact",
    })
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (query.status) builder = builder.eq("status", query.status);
  if (query.orderId) builder = builder.eq("order_id", query.orderId);
  if (query.serviceCode) builder = builder.eq("service_code", query.serviceCode);
  if (query.q) {
    const parts = [orIlike(["barcode", "tracking_number"], query.q)];
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.q)) {
      parts.push(`id.eq.${query.q}`);
    }
    const filter = parts.filter(Boolean).join(",");
    if (filter) builder = builder.or(filter);
  }

  const { data, error, count } = await builder;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return {
    items: (data ?? []).map(mapShipment),
    page: query.page,
    pageSize: query.pageSize,
    total: count ?? 0,
  };
}

export async function getShipment(supabase: SupabaseClient, ctx: TenantContext, id: string) {
  const { data, error } = await supabase
    .from("shipments")
    .select("*, orders(order_number), customers(name, phone), tracking_events(*), labels(*)")
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Shipment not found.");
  return {
    ...mapShipment(data),
    events: data.tracking_events ?? [],
  };
}

export async function retryShipment(supabase: SupabaseClient, ctx: TenantContext, id: string) {
  await getShipment(supabase, ctx, id);
  await supabase
    .from("shipments")
    .update({ status: "QUEUED", last_error: null, last_error_code: null })
    .eq("id", id);
  const job = await createBackgroundJob(supabase, {
    organizationId: ctx.organizationId,
    jobType: "shipment-booking",
    entityType: "shipment",
    entityId: id,
    userId: ctx.userId,
  });
  return { shipmentId: id, jobId: job.id, message: "Retry queued." };
}

function mapShipment(row: Record<string, unknown>) {
  const order = row.orders as { order_number?: string } | null;
  const customer = row.customers as { name?: string; phone?: string } | null;
  return {
    ...row,
    orderNumber: order?.order_number,
    order_number: order?.order_number,
    customer,
    trackingNumber: row.tracking_number,
    serviceCode: row.service_code,
    createdAt: row.created_at,
  };
}
