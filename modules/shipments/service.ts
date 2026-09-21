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
    action?: "processing" | "fulfill" | "in_transit" | "delivered";
  }
) {
  if (!orderIds.length) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Select at least one order.");
  }

  if (extras?.action === "in_transit" || extras?.action === "delivered") {
    return markWatiShipmentStage(supabase, ctx, orderIds, extras.action);
  }

  const action = extras?.action === "processing" ? "processing" : extras?.action === "fulfill" ? "fulfill" : null;
  const enqueueBooking = action === "processing" ? false : extras?.enqueueBooking !== false;

  const { data: orders, error } = await supabase
    .from("orders")
    .select("*, order_line_items(quantity, weight_grams, unit_price)")
    .eq("organization_id", ctx.organizationId)
    .in("id", orderIds);

  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!orders?.length) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Orders not found.");

  const { data: existing } = await supabase
    .from("shipments")
    .select("id, order_id, status")
    .eq("organization_id", ctx.organizationId)
    .in("order_id", orders.map((order) => order.id))
    .not("status", "eq", "CANCELLED");
  const existingByOrder = new Map<string, { id: string; order_id: string; status: string }>();
  for (const row of existing ?? []) {
    const prev = existingByOrder.get(row.order_id as string);
    if (!prev || ((prev.status === "FAILED") && row.status !== "FAILED")) {
      existingByOrder.set(row.order_id as string, row as { id: string; order_id: string; status: string });
    }
  }

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
    const current = existingByOrder.get(order.id);
    const currentStatus = (current?.status ?? "").toUpperCase();
    const alreadyBooked = ["BOOKED", "LABEL_PENDING", "LABEL_READY", "MANIFEST_PENDING", "MANIFEST_READY", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"].includes(
      currentStatus
    );

    if (action === "processing" && current && currentStatus !== "FAILED") {
      if (!alreadyBooked) {
        await applyProcessingSideEffects(supabase, ctx, order.id, current.id);
      } else {
        await enqueueOptionalWatiNotify(supabase, ctx.organizationId, "processing", {
          orderId: order.id,
          shipmentId: current.id,
        });
      }
      created.push({ ...current, jobId: null });
      continue;
    }

    if (action === "fulfill" && current && alreadyBooked) {
      await enqueueOptionalWatiNotify(supabase, ctx.organizationId, "booked", {
        orderId: order.id,
        shipmentId: current.id,
      });
      created.push({ ...current, jobId: null });
      continue;
    }

    if (enqueueBooking && current && !alreadyBooked) {
      await supabase
        .from("shipments")
        .update({ status: "QUEUED", last_error: null, last_error_code: null })
        .eq("id", current.id);
      const job = await createBackgroundJob(supabase, {
        organizationId: ctx.organizationId,
        jobType: "shipment-booking",
        entityType: "shipment",
        entityId: current.id,
        userId: ctx.userId,
      });
      created.push({ ...current, jobId: job.id });
      continue;
    }

    if (current && (alreadyBooked || currentStatus !== "FAILED")) {
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
        status: enqueueBooking ? "QUEUED" : "DRAFT",
      })
      .select()
      .single();

    if (shipError || !shipment) {
      throw new AppError(ERROR_CODES.SHIPMENT_FAILED, shipError?.message || "Shipment create failed.");
    }

    if (action === "processing") {
      await applyProcessingSideEffects(supabase, ctx, order.id, shipment.id);
    } else {
      await supabase.from("orders").update({ status: "PROCESSING" }).eq("id", order.id);
      if (action !== "fulfill") {
        await enqueueOptionalWatiNotify(supabase, ctx.organizationId, "processing", {
          orderId: order.id,
          shipmentId: shipment.id,
        });
      }
    }

    if (!enqueueBooking) {
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
    action:
      action === "processing"
        ? "shipment.processing"
        : action === "fulfill"
          ? "shipment.created"
          : "shipment.created",
    entity_type: "shipment",
    after: { count: created.length, orderIds, skipped, action },
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

async function requireWatiConnected(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("wati_connections")
    .select("status")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if ((data?.status ?? "").toUpperCase() !== "CONNECTED") {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Connect Wati to use this status.");
  }
}

async function applyProcessingSideEffects(
  supabase: SupabaseClient,
  ctx: TenantContext,
  orderId: string,
  shipmentId?: string | null
) {
  await supabase.from("orders").update({ status: "PROCESSING" }).eq("id", orderId);
  try {
    const { markShopifyOrderProcessing } = await import("@/modules/shopify/orders");
    await markShopifyOrderProcessing(supabase, { organizationId: ctx.organizationId, orderId });
  } catch {
    // Shopify in-progress is optional; Processing should still succeed.
  }
  await enqueueOptionalWatiNotify(supabase, ctx.organizationId, "processing", {
    orderId,
    shipmentId,
  });
}

async function enqueueOptionalWatiNotify(
  supabase: SupabaseClient,
  organizationId: string,
  event: "processing" | "booked" | "in_transit" | "delivered",
  ids: { orderId?: string | null; shipmentId?: string | null }
) {
  try {
    const { enqueueWatiNotify } = await import("@/modules/wati/send");
    await enqueueWatiNotify(supabase, organizationId, event, ids);
  } catch {
    // WhatsApp is optional; the order status change should still succeed.
  }
}

async function markWatiShipmentStage(
  supabase: SupabaseClient,
  ctx: TenantContext,
  orderIds: string[],
  action: "in_transit" | "delivered"
) {
  await requireWatiConnected(supabase, ctx.organizationId);

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, status")
    .eq("organization_id", ctx.organizationId)
    .in("id", orderIds);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!orders?.length) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Orders not found.");

  const { data: existing } = await supabase
    .from("shipments")
    .select("id, order_id, status")
    .eq("organization_id", ctx.organizationId)
    .in("order_id", orders.map((order) => order.id))
    .not("status", "eq", "CANCELLED");
  const existingByOrder = new Map<string, { id: string; order_id: string; status: string }>();
  for (const row of existing ?? []) {
    const prev = existingByOrder.get(row.order_id as string);
    if (!prev || (prev.status === "FAILED" && row.status !== "FAILED")) {
      existingByOrder.set(row.order_id as string, row as { id: string; order_id: string; status: string });
    }
  }

  const nextStatus = action === "delivered" ? "DELIVERED" : "IN_TRANSIT";
  const watiEvent = action === "delivered" ? "delivered" : "in_transit";
  const updated = [];
  const skipped = [];

  for (const order of orders) {
    const currentStatus = (order.status ?? "").toUpperCase();
    if (currentStatus === "CANCELLED") {
      skipped.push(order.id);
      continue;
    }
    if (action === "in_transit" && currentStatus === "DELIVERED") {
      skipped.push(order.id);
      continue;
    }

    const shipment = existingByOrder.get(order.id);
    if (currentStatus !== nextStatus) {
      await supabase.from("orders").update({ status: nextStatus }).eq("id", order.id);
      if (shipment) {
        await supabase.from("shipments").update({ status: nextStatus }).eq("id", shipment.id);
      }
    }

    await enqueueOptionalWatiNotify(supabase, ctx.organizationId, watiEvent, {
      orderId: order.id,
      shipmentId: shipment?.id,
    });
    updated.push({ ...(shipment ?? { id: order.id, order_id: order.id, status: nextStatus }), jobId: null });
  }

  if (!updated.length) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      skipped.length === 1
        ? "This order cannot be marked with that status."
        : "None of the selected orders can be marked with that status."
    );
  }

  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: action === "delivered" ? "shipment.delivered" : "shipment.in_transit",
    entity_type: "shipment",
    after: { count: updated.length, orderIds, skipped, action },
  });

  return { queued: updated.length, skipped, shipments: updated };
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
