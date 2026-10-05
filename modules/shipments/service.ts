import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { orIlike } from "@/lib/api/filters";
import type { TenantContext } from "@/lib/api/context";
import { createBackgroundJob } from "@/modules/jobs/service";
import { resolveOrderBookingService, shipmentServiceLocked } from "@/modules/india-post/booking-service";
import { isIndiaPostAcceptedStatus } from "@/modules/india-post/booking-status";
import { resolveDefaultServiceCode, savedParcelContracts } from "@/modules/india-post/contracts";
import { shipmentCollectFromOrder } from "@/modules/orders/payment";
import { bookingBoxWeightGrams } from "@/modules/orders/weight";
import { INDIA_POST_SERVICES } from "@/types/domain";

const OPEN_SHIPMENT_STATUSES = ["DRAFT", "QUEUED", "FAILED"] as const;

function assertIndiaPostService(serviceCode: string) {
  if (!INDIA_POST_SERVICES.some((service) => service.code === serviceCode)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `${serviceCode} is not a service India Post accepts.`
    );
  }
}

export async function workspaceBookingChoice(supabase: SupabaseClient, organizationId: string) {
  const [{ data }, defaultService, contracts] = await Promise.all([
    supabase
      .from("india_post_connections")
      .select("booking_service_override")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    resolveDefaultServiceCode(supabase, organizationId),
    supabase
      .from("india_post_contracts")
      .select("service_code, contract_id, is_active")
      .eq("organization_id", organizationId),
  ]);
  const allowedServices = savedParcelContracts({
    contracts: (contracts.data ?? []).map((row) => ({
      serviceCode: String(row.service_code ?? ""),
      contractId: String(row.contract_id ?? ""),
      isActive: row.is_active !== false,
    })),
  }).map((contract) => contract.serviceCode);
  return {
    workspaceOverride: (data?.booking_service_override as string | null) ?? null,
    defaultService,
    allowedServices,
  };
}

export async function syncOpenShipmentsService(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentIds: string[],
  serviceCode: string
) {
  if (!shipmentIds.length) return;
  assertIndiaPostService(serviceCode);
  for (let index = 0; index < shipmentIds.length; index += 200) {
    const chunk = shipmentIds.slice(index, index + 200);
    const { error } = await supabase
      .from("shipments")
      .update({ service_code: serviceCode })
      .eq("organization_id", organizationId)
      .in("id", chunk)
      .in("status", [...OPEN_SHIPMENT_STATUSES]);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }
}

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
  if (enqueueBooking) {
    const { checkQuota } = await import("@/modules/billing/usage");
    await checkQuota(supabase, ctx.organizationId, orderIds.length);
  }

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

  const explicitService = extras?.serviceCode?.trim() || "";
  if (explicitService) assertIndiaPostService(explicitService);
  const bookingChoice = explicitService ? null : await workspaceBookingChoice(supabase, ctx.organizationId);
  const serviceFor = (order: { india_post_service?: string | null }) => {
    if (explicitService) return explicitService;
    const resolved = resolveOrderBookingService({
      orderService: order.india_post_service,
      workspaceOverride: bookingChoice?.workspaceOverride,
      defaultService: bookingChoice?.defaultService,
      allowedServices: bookingChoice?.allowedServices,
    });
    assertIndiaPostService(resolved);
    return resolved;
  };

  const created = [];
  const skipped = [];
  for (const order of orders) {
    const current = existingByOrder.get(order.id);
    const currentStatus = (current?.status ?? "").toUpperCase();
    const alreadyBooked = isIndiaPostAcceptedStatus(currentStatus);
    const items = (order.order_line_items as Array<{ quantity: number; weight_grams?: number }>) ?? [];
    const weight = bookingBoxWeightGrams({
      parcelWeightMode: order.parcel_weight_mode as string | null,
      parcelWeightGrams: order.parcel_weight_grams as number | null,
      lineItems: items,
      explicitGrams: extras?.weightGrams,
    });

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
      try {
        const { syncShopifyOrderStage } = await import("@/modules/shopify/orders");
        await syncShopifyOrderStage(supabase, {
          organizationId: ctx.organizationId,
          orderId: order.id,
          shipmentId: current.id,
          stage: "booked",
        });
      } catch {
        // Shopify fulfillment is optional when the article is already booked.
      }
      created.push({ ...current, jobId: null });
      continue;
    }

    if (enqueueBooking && current && !alreadyBooked) {
      const collect = shipmentCollectFromOrder(order);
      await supabase
        .from("shipments")
        .update({
          status: "QUEUED",
          last_error: null,
          last_error_code: null,
          payment_mode: collect.payment_mode,
          cod_amount: collect.cod_amount,
          service_code: serviceFor(order),
          weight_grams: weight,
          ...(extras?.lengthCm != null ? { length_cm: extras.lengthCm } : {}),
          ...(extras?.widthCm != null ? { width_cm: extras.widthCm } : {}),
          ...(extras?.heightCm != null ? { height_cm: extras.heightCm } : {}),
        })
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

    const collect = shipmentCollectFromOrder(order);
    const { data: shipment, error: shipError } = await supabase
      .from("shipments")
      .insert({
        organization_id: ctx.organizationId,
        order_id: order.id,
        customer_id: order.customer_id,
        shipping_address_id: order.shipping_address_id,
        service_code: serviceFor(order),
        payment_mode: collect.payment_mode,
        cod_amount: collect.cod_amount,
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
    .select(
      "*, orders(order_number, total_amount, created_at), customers(name, phone), tracking_events(*), labels(*), shipping_invoices(id, status, invoice_number, error_message, created_at), addresses!shipping_address_id(city, state, pincode), pickup_locations(city, name)"
    )
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

export async function retryShipment(
  supabase: SupabaseClient,
  ctx: TenantContext,
  id: string,
  extras?: {
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
    weightGrams?: number;
  }
) {
  const shipment = await getShipment(supabase, ctx, id);
  const { checkQuota } = await import("@/modules/billing/usage");
  await checkQuota(supabase, ctx.organizationId, 1);
  const orderId = shipment.orderId ?? shipment.order_id ?? "";
  let serviceCode: string | undefined;
  if (orderId && !shipmentServiceLocked(String(shipment.status ?? ""))) {
    const { data: order } = await supabase
      .from("orders")
      .select("india_post_service")
      .eq("id", orderId)
      .maybeSingle();
    const choice = await workspaceBookingChoice(supabase, ctx.organizationId);
    serviceCode = resolveOrderBookingService({
      orderService: order?.india_post_service,
      workspaceOverride: choice.workspaceOverride,
      defaultService: choice.defaultService,
      allowedServices: choice.allowedServices,
    });
    assertIndiaPostService(serviceCode);
  }
  await supabase
    .from("shipments")
    .update({
      status: "QUEUED",
      last_error: null,
      last_error_code: null,
      ...(serviceCode ? { service_code: serviceCode } : {}),
      ...(extras?.weightGrams != null && extras.weightGrams > 0 ? { weight_grams: Math.round(extras.weightGrams) } : {}),
      ...(extras?.lengthCm != null && extras.lengthCm > 0 ? { length_cm: extras.lengthCm } : {}),
      ...(extras?.widthCm != null && extras.widthCm > 0 ? { width_cm: extras.widthCm } : {}),
      ...(extras?.heightCm != null && extras.heightCm > 0 ? { height_cm: extras.heightCm } : {}),
    })
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

export const updateShipmentDimensionsSchema = z.preprocess(
  (val: unknown) => {
    if (!val || typeof val !== "object") return val;
    const v = val as Record<string, unknown>;
    return {
      lengthCm: v.lengthCm ?? v.length_cm ?? v.length,
      widthCm: v.widthCm ?? v.width_cm ?? v.width,
      heightCm: v.heightCm ?? v.height_cm ?? v.height,
      boxWeightGrams:
        v.boxWeightGrams ??
        v.box_weight_grams ??
        v.weightGrams ??
        v.weight_grams ??
        v.boxWeight ??
        v.weight,
      parcelWeightMode: v.parcelWeightMode ?? v.parcel_weight_mode,
      lineItems: v.lineItems ?? v.line_items,
      shape: v.shape,
    };
  },
  z.object({
    lengthCm: z.coerce
      .number()
      .positive("Length must be greater than 0")
      .min(14, "Length must be between 14 and 150 cm.")
      .max(150, "Length must be between 14 and 150 cm."),
    widthCm: z.coerce
      .number()
      .positive("Width must be greater than 0")
      .min(9, "Width must be between 9 and 150 cm.")
      .max(150, "Width must be between 9 and 150 cm."),
    heightCm: z.coerce
      .number()
      .positive("Height must be greater than 0")
      .min(1, "Height must be between 1 and 150 cm.")
      .max(150, "Height must be between 1 and 150 cm."),
    boxWeightGrams: z.coerce.number().int().min(1, "Box weight must be at least 1 g").optional(),
    parcelWeightMode: z.enum(["auto", "manual"]).optional(),
    lineItems: z
      .array(
        z.object({
          id: z.string(),
          weightGrams: z.coerce.number().int().min(0),
          weightMode: z.enum(["auto", "manual"]).optional(),
        })
      )
      .optional(),
    shape: z.enum(["NROL", "ROLL"]).optional(),
  })
);

export async function updateShipmentDimensions(
  supabase: SupabaseClient,
  ctx: TenantContext,
  shipmentId: string,
  input: z.infer<typeof updateShipmentDimensionsSchema>
) {
  const { data: shipment, error } = await supabase
    .from("shipments")
    .select("id, status, order_id, organization_id")
    .eq("organization_id", ctx.organizationId)
    .eq("id", shipmentId)
    .maybeSingle();

  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!shipment) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Shipment not found.");

  if (isIndiaPostAcceptedStatus(String(shipment.status ?? ""))) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      "Cannot update dimensions for a shipment that is already booked with India Post."
    );
  }

  const orderId = shipment.order_id as string | undefined;

  // 1. If line items weights are supplied, update order_line_items
  if (input.lineItems?.length && orderId) {
    for (const item of input.lineItems) {
      if (item.id) {
        await supabase
          .from("order_line_items")
          .update({
            weight_grams: item.weightGrams > 0 ? item.weightGrams : null,
            weight_edited: (item.weightMode ?? "manual") === "manual",
          })
          .eq("organization_id", ctx.organizationId)
          .eq("order_id", orderId)
          .eq("id", item.id);
      }
    }
  }

  // 2. Resolve box weight if boxWeightGrams or lineItems are provided
  let boxWeight: number | undefined;
  if (input.boxWeightGrams != null && input.boxWeightGrams > 0) {
    boxWeight = Math.round(input.boxWeightGrams);
    if (orderId) {
      await supabase
        .from("orders")
        .update({
          parcel_weight_mode: input.parcelWeightMode ?? "manual",
          parcel_weight_grams: boxWeight,
        })
        .eq("organization_id", ctx.organizationId)
        .eq("id", orderId);
    }
  } else if (input.lineItems?.length) {
    boxWeight = bookingBoxWeightGrams({
      parcelWeightMode: input.parcelWeightMode ?? "auto",
      lineItems: input.lineItems,
    });
    if (orderId) {
      await supabase
        .from("orders")
        .update({
          parcel_weight_mode: input.parcelWeightMode ?? "auto",
          parcel_weight_grams: input.parcelWeightMode === "manual" ? boxWeight : null,
        })
        .eq("organization_id", ctx.organizationId)
        .eq("id", orderId);
    }
  }

  // 3. Update shipment record
  const updatePayload: Record<string, unknown> = {
    length_cm: input.lengthCm,
    width_cm: input.widthCm,
    height_cm: input.heightCm,
  };
  if (boxWeight != null && boxWeight > 0) {
    updatePayload.weight_grams = boxWeight;
  }

  const { data: updated, error: updateError } = await supabase
    .from("shipments")
    .update(updatePayload)
    .eq("organization_id", ctx.organizationId)
    .eq("id", shipmentId)
    .select(
      "*, orders(order_number, total_amount, created_at), customers(name, phone), addresses!shipping_address_id(city, state, pincode), pickup_locations(city, name), shipping_invoices(id, status, invoice_number, error_message)"
    )
    .single();

  if (updateError || !updated) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, updateError?.message || "Failed to update shipment dimensions.");
  }

  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "shipment.dimensions_updated",
    entity_type: "shipment",
    entity_id: shipmentId,
    after: {
      length_cm: input.lengthCm,
      width_cm: input.widthCm,
      height_cm: input.heightCm,
      ...(boxWeight != null ? { weight_grams: boxWeight } : {}),
    },
  });

  return mapShipment(updated);
}

export async function setOrderShipmentDimensions(
  supabase: SupabaseClient,
  ctx: TenantContext,
  orderId: string,
  input: z.infer<typeof updateShipmentDimensionsSchema>
) {
  const { data: order, error } = await supabase
    .from("orders")
    .select("*, order_line_items(id, quantity, weight_grams, unit_price), shipments(id, status, created_at)")
    .eq("organization_id", ctx.organizationId)
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!order) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found.");

  const shipments = (order.shipments as Array<{ id: string; status: string; created_at?: string }> | undefined) ?? [];
  const openShipment = shipments.find((s) => !["CANCELLED"].includes(String(s.status ?? "").toUpperCase()));

  if (openShipment) {
    return updateShipmentDimensions(supabase, ctx, openShipment.id, input);
  }

  // 1. If line items weights are supplied, update order_line_items
  if (input.lineItems?.length) {
    for (const item of input.lineItems) {
      if (item.id) {
        await supabase
          .from("order_line_items")
          .update({
            weight_grams: item.weightGrams > 0 ? item.weightGrams : null,
            weight_edited: (item.weightMode ?? "manual") === "manual",
          })
          .eq("organization_id", ctx.organizationId)
          .eq("order_id", orderId)
          .eq("id", item.id);
      }
    }
  }

  const choice = await workspaceBookingChoice(supabase, ctx.organizationId);
  const serviceCode = resolveOrderBookingService({
    orderService: order.india_post_service,
    workspaceOverride: choice?.workspaceOverride,
    defaultService: choice?.defaultService,
    allowedServices: choice?.allowedServices,
  });
  assertIndiaPostService(serviceCode);

  const weight =
    input.boxWeightGrams != null && input.boxWeightGrams > 0
      ? Math.round(input.boxWeightGrams)
      : bookingBoxWeightGrams({
          parcelWeightMode: input.parcelWeightMode ?? order.parcel_weight_mode ?? "auto",
          parcelWeightGrams: order.parcel_weight_grams != null ? Number(order.parcel_weight_grams) : null,
          lineItems:
            input.lineItems ??
            (order.order_line_items ?? []).map((item: { quantity?: number; weight_grams?: number | null }) => ({
              quantity: Number(item.quantity ?? 1),
              weightGrams: item.weight_grams != null ? Number(item.weight_grams) : null,
            })),
        });

  if (input.boxWeightGrams != null && input.boxWeightGrams > 0) {
    await supabase
      .from("orders")
      .update({
        parcel_weight_mode: input.parcelWeightMode ?? "manual",
        parcel_weight_grams: weight,
      })
      .eq("organization_id", ctx.organizationId)
      .eq("id", orderId);
  }

  const collect = shipmentCollectFromOrder(order);
  const { data: shipment, error: shipError } = await supabase
    .from("shipments")
    .insert({
      organization_id: ctx.organizationId,
      order_id: order.id,
      customer_id: order.customer_id,
      shipping_address_id: order.shipping_address_id,
      service_code: serviceCode,
      payment_mode: collect.payment_mode,
      cod_amount: collect.cod_amount,
      weight_grams: weight,
      length_cm: input.lengthCm,
      width_cm: input.widthCm,
      height_cm: input.heightCm,
      status: "DRAFT",
    })
    .select(
      "*, orders(order_number, total_amount, created_at), customers(name, phone), addresses!shipping_address_id(city, state, pincode), pickup_locations(city, name), shipping_invoices(id, status, invoice_number, error_message)"
    )
    .single();

  if (shipError || !shipment) {
    throw new AppError(ERROR_CODES.SHIPMENT_FAILED, shipError?.message || "Failed to create shipment.");
  }

  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "shipment.dimensions_created",
    entity_type: "shipment",
    entity_id: shipment.id,
    after: {
      length_cm: input.lengthCm,
      width_cm: input.widthCm,
      height_cm: input.heightCm,
      weight_grams: weight,
    },
  });

  return mapShipment(shipment);
}

async function requireShipmentStageIntegrations(supabase: SupabaseClient, organizationId: string) {
  const [{ data: wati }, { data: shopify }] = await Promise.all([
    supabase.from("wati_connections").select("status").eq("organization_id", organizationId).maybeSingle(),
    supabase.from("shopify_connections").select("status").eq("organization_id", organizationId).maybeSingle(),
  ]);
  const watiOn = (wati?.status ?? "").toUpperCase() === "CONNECTED";
  const shopifyOn = (shopify?.status ?? "").toUpperCase() === "CONNECTED";
  if (!watiOn && !shopifyOn) {
    throw new AppError(
      ERROR_CODES.INTEGRATION_NOT_CONNECTED,
      "Connect Wati or Shopify to update this order status."
    );
  }
}

async function applyProcessingSideEffects(
  supabase: SupabaseClient,
  ctx: TenantContext,
  orderId: string,
  shipmentId?: string | null
) {
  const { data: orderRow } = await supabase
    .from("orders")
    .select("source, status, order_number")
    .eq("id", orderId)
    .maybeSingle();
  const alreadyProcessing = (orderRow?.status ?? "").toUpperCase() === "PROCESSING";
  await supabase.from("orders").update({ status: "PROCESSING" }).eq("id", orderId);
  if (!alreadyProcessing) {
    try {
      const { insertOrderStageNotification } = await import("@/lib/notifications/order-stage");
      await insertOrderStageNotification(supabase, {
        organizationId: ctx.organizationId,
        orderId,
        event: "processing",
        body: orderRow?.order_number ?? null,
      });
    } catch {
      // In-app alerts are optional; processing should still succeed.
    }
  }
  const isShopify = (orderRow?.source || "").toUpperCase() === "SHOPIFY";
  let shopifySynced = !isShopify;
  try {
    const { syncShopifyOrderStage, enqueueShopifyStageSync } = await import("@/modules/shopify/orders");
    const result = await syncShopifyOrderStage(supabase, {
      organizationId: ctx.organizationId,
      orderId,
      shipmentId,
      stage: "processing",
    });
    if (isShopify) {
      shopifySynced = Boolean(result && (!result.skipped || ("tagged" in result && result.tagged)));
    }
    if (result && "skipped" in result && result.skipped && result.reason !== "not_shopify" && result.reason !== "shopify_not_connected") {
      await enqueueShopifyStageSync(supabase, {
        organizationId: ctx.organizationId,
        orderId,
        shipmentId,
        stage: "processing",
        userId: ctx.userId,
      });
    }
  } catch {
    try {
      const { enqueueShopifyStageSync } = await import("@/modules/shopify/orders");
      await enqueueShopifyStageSync(supabase, {
        organizationId: ctx.organizationId,
        orderId,
        shipmentId,
        stage: "processing",
        userId: ctx.userId,
      });
    } catch {
      // Shopify in-progress is retried by shopify-fulfillment jobs.
    }
  }
  if (!isShopify || shopifySynced) {
    await enqueueOptionalWatiNotify(supabase, ctx.organizationId, "processing", {
      orderId,
      shipmentId,
    });
  }
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
  try {
    const { enqueueVachatNotify } = await import("@/modules/vachat/send");
    await enqueueVachatNotify(supabase, organizationId, event, ids);
  } catch {
    // Vachat is optional; the order status change should still succeed.
  }
}

async function markWatiShipmentStage(
  supabase: SupabaseClient,
  ctx: TenantContext,
  orderIds: string[],
  action: "in_transit" | "delivered"
) {
  await requireShipmentStageIntegrations(supabase, ctx.organizationId);

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
      try {
        const { insertOrderStageNotification } = await import("@/lib/notifications/order-stage");
        await insertOrderStageNotification(supabase, {
          organizationId: ctx.organizationId,
          orderId: order.id,
          event: watiEvent,
        });
      } catch {
        // In-app alerts are optional; the status change should still succeed.
      }
    }

    await enqueueOptionalWatiNotify(supabase, ctx.organizationId, watiEvent, {
      orderId: order.id,
      shipmentId: shipment?.id,
    });
    try {
      const { syncShopifyOrderStage, enqueueShopifyStageSync } = await import("@/modules/shopify/orders");
      const result = await syncShopifyOrderStage(supabase, {
        organizationId: ctx.organizationId,
        orderId: order.id,
        shipmentId: shipment?.id,
        stage: watiEvent,
      });
      if (result && "skipped" in result && result.skipped && result.reason !== "not_shopify" && result.reason !== "shopify_not_connected") {
        await enqueueShopifyStageSync(supabase, {
          organizationId: ctx.organizationId,
          orderId: order.id,
          shipmentId: shipment?.id,
          stage: watiEvent,
          userId: ctx.userId,
        });
      }
    } catch {
      try {
        const { enqueueShopifyStageSync } = await import("@/modules/shopify/orders");
        await enqueueShopifyStageSync(supabase, {
          organizationId: ctx.organizationId,
          orderId: order.id,
          shipmentId: shipment?.id,
          stage: watiEvent,
          userId: ctx.userId,
        });
      } catch {
        // Shopify fulfillment events are retried by shopify-fulfillment jobs.
      }
    }
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

function nestedRows(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (typeof value === "object") return [value as Record<string, unknown>];
  return [];
}

function mapShipment(row: Record<string, unknown>) {
  const order = row.orders as { order_number?: string; total_amount?: number | string; created_at?: string } | null;
  const customer = row.customers as { name?: string; phone?: string } | null;
  const address = nestedOne(row.addresses) as { city?: string; state?: string; pincode?: string } | null;
  const pickup = nestedOne(row.pickup_locations) as { city?: string; name?: string } | null;
  const invoice = nestedRows(row.shipping_invoices)[0];
  return {
    ...row,
    orderId: row.order_id as string | undefined,
    order_id: row.order_id as string | undefined,
    status: row.status as string | undefined,
    weightGrams: row.weight_grams != null ? Number(row.weight_grams) : undefined,
    weight_grams: row.weight_grams != null ? Number(row.weight_grams) : undefined,
    lengthCm: row.length_cm != null ? Number(row.length_cm) : undefined,
    length_cm: row.length_cm != null ? Number(row.length_cm) : undefined,
    widthCm: row.width_cm != null ? Number(row.width_cm) : undefined,
    width_cm: row.width_cm != null ? Number(row.width_cm) : undefined,
    heightCm: row.height_cm != null ? Number(row.height_cm) : undefined,
    height_cm: row.height_cm != null ? Number(row.height_cm) : undefined,
    orderNumber: order?.order_number,
    order_number: order?.order_number,
    orderTotal: order?.total_amount ?? null,
    orderCreatedAt: order?.created_at ?? null,
    customer,
    shippingCity: address?.city ?? null,
    shippingPincode: address?.pincode ?? null,
    originCity: pickup?.city ?? null,
    trackingNumber: row.tracking_number,
    lastError: (row.last_error as string | null | undefined) ?? null,
    last_error: (row.last_error as string | null | undefined) ?? null,
    serviceCode: row.service_code,
    createdAt: row.created_at,
    operationalStatus: row.operational_status,
    lastEventCode: row.last_event_code,
    lastEventDescription: row.last_event_description,
    lastScanOffice: row.last_scan_office,
    lastEventAt: row.last_event_at,
    lastTrackedAt: row.last_tracked_at,
    ndrReason: row.ndr_reason,
    ndrAttemptCount: row.ndr_attempt_count,
    ndrLastAttemptAt: row.ndr_last_attempt_at,
    rtoReason: row.rto_reason,
    rtoInitiatedAt: row.rto_initiated_at,
    deliveredAt: row.delivered_at,
    invoice: invoice
      ? {
          id: invoice.id,
          status: invoice.status,
          invoiceNumber: invoice.invoice_number,
          invoice_number: invoice.invoice_number,
          errorMessage: invoice.error_message,
        }
      : null,
  };
}

function nestedOne(value: unknown) {
  return nestedRows(value)[0] ?? null;
}
