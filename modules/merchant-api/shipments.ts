import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { labelPdfFileResponse } from "@/lib/labels/pdf-response";
import type { MerchantApiKeyContext } from "@/modules/merchant-api/auth";
import { decodeCursor, encodeCursor, publicShipmentDto, publicTrackingDto } from "@/modules/merchant-api/dto";
import { MerchantApiError, MERCHANT_ERROR_CODES } from "@/modules/merchant-api/errors";
import { merchantActor } from "@/modules/merchant-api/orders";
import { merchantBookOrderSchema, merchantShipmentListQuery } from "@/modules/merchant-api/schema";
import { loadLabelPdfBytes } from "@/modules/labels/load";
import { enqueueOrgTrackingSyncIfIdle } from "@/modules/india-post/tracking-sync";
import { createShipmentsForOrders, getShipment } from "@/modules/shipments/service";

const TRACKING_STALE_MS = 15 * 60 * 1000;
const TERMINAL = new Set(["DELIVERED", "CANCELLED", "RTO_DELIVERED"]);

export async function bookMerchantOrder(
  supabase: SupabaseClient,
  ctx: MerchantApiKeyContext,
  orderId: string,
  raw: unknown
) {
  const body = merchantBookOrderSchema.parse(raw ?? {});
  const tenant = merchantActor(ctx);

  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("id", orderId)
    .maybeSingle();
  if (!order) {
    throw new MerchantApiError(MERCHANT_ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found.");
  }

  try {
    const result = await createShipmentsForOrders(supabase, tenant, [orderId], {
      weightGrams: body.weight_grams,
      lengthCm: body.length_cm,
      widthCm: body.width_cm,
      heightCm: body.height_cm,
      serviceCode: body.service_code,
      enqueueBooking: true,
      runBookingNow: false,
    });
    const shipments = (result.shipments ?? []).map((row) => publicShipmentDto(row as Record<string, unknown>));
    return {
      accepted: true,
      state: "queued",
      queued: result.queued,
      skipped: result.skipped,
      shipments,
    };
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.CONFLICT) {
      const { data: existing } = await supabase
        .from("shipments")
        .select("*")
        .eq("organization_id", ctx.organizationId)
        .eq("order_id", orderId)
        .not("status", "eq", "CANCELLED")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        return {
          accepted: true,
          state: String(existing.status ?? "").toUpperCase() === "BOOKED" ? "booked" : "queued",
          queued: 0,
          skipped: [orderId],
          shipments: [publicShipmentDto(existing as Record<string, unknown>)],
        };
      }
      throw new MerchantApiError(MERCHANT_ERROR_CODES.BOOKING_NOT_ALLOWED, error.message);
    }
    throw error;
  }
}

export async function getMerchantShipment(supabase: SupabaseClient, ctx: MerchantApiKeyContext, shipmentId: string) {
  const shipment = await getShipment(supabase, merchantActor(ctx), shipmentId);
  return publicShipmentDto(shipment as Record<string, unknown>);
}

export async function listMerchantShipments(
  supabase: SupabaseClient,
  ctx: MerchantApiKeyContext,
  search: URLSearchParams
) {
  const query = merchantShipmentListQuery.parse({
    updated_since: search.get("updated_since") ?? undefined,
    status: search.get("status") ?? undefined,
    order_id: search.get("order_id") ?? undefined,
    limit: search.get("limit") ?? undefined,
    cursor: search.get("cursor") ?? undefined,
  });
  const cursor = decodeCursor(query.cursor);
  let builder = supabase
    .from("shipments")
    .select("*, orders(order_number)")
    .eq("organization_id", ctx.organizationId)
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(query.limit + 1);
  if (query.status) builder = builder.eq("status", query.status);
  if (query.order_id) builder = builder.eq("order_id", query.order_id);
  if (query.updated_since) builder = builder.gte("updated_at", query.updated_since);
  if (cursor) builder = builder.or(`updated_at.gt.${cursor.u},and(updated_at.eq.${cursor.u},id.gt.${cursor.i})`);
  const { data, error } = await builder;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unable to list shipments.");
  const rows = data ?? [];
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1] as { updated_at?: string; id?: string } | undefined;
  return {
    items: page.map((row) => publicShipmentDto(row as Record<string, unknown>)),
    next_cursor: hasMore && last?.updated_at && last.id ? encodeCursor(String(last.updated_at), String(last.id)) : null,
  };
}

export async function getMerchantTracking(supabase: SupabaseClient, ctx: MerchantApiKeyContext, shipmentId: string) {
  const shipment = (await getShipment(supabase, merchantActor(ctx), shipmentId)) as Record<string, unknown>;
  const lastAt = shipment.lastEventAt ?? shipment.last_event_at ?? shipment.lastTrackedAt ?? null;
  const status = String(shipment.status ?? "").toUpperCase();
  const stale = !lastAt || Date.now() - new Date(String(lastAt)).getTime() > TRACKING_STALE_MS;
  if (stale && !TERMINAL.has(status) && shipment.barcode) {
    void enqueueOrgTrackingSyncIfIdle(supabase, ctx.organizationId);
  }
  return publicTrackingDto(shipment);
}

export async function getMerchantLabel(
  supabase: SupabaseClient,
  ctx: MerchantApiKeyContext,
  shipmentId: string
) {
  const { data: shipment } = await supabase
    .from("shipments")
    .select("id, barcode, booked_at")
    .eq("organization_id", ctx.organizationId)
    .eq("id", shipmentId)
    .maybeSingle();
  if (!shipment) {
    throw new MerchantApiError(MERCHANT_ERROR_CODES.RESOURCE_NOT_FOUND, "Shipment not found.");
  }
  const { data: label } = await supabase
    .from("labels")
    .select("id, file_path, file_url, shipment_id, kind")
    .eq("organization_id", ctx.organizationId)
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!label?.file_path && !label?.file_url) {
    throw new MerchantApiError(MERCHANT_ERROR_CODES.RESOURCE_NOT_FOUND, "Label file not found.");
  }
  const bytes = await loadLabelPdfBytes(supabase, ctx.organizationId, {
    id: String(label.id),
    file_path: label.file_path || "",
    file_url: label.file_url,
    shipment_id: label.shipment_id,
  });
  return labelPdfFileResponse(bytes, `india-post-${shipmentId}.pdf`, "attachment");
}
