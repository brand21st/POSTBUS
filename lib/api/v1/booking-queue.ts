import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import {
  ENQUEUE_MAX_ORDERS,
  enqueueOrders,
  getQueueItem,
  listBookingHistory,
  listQueueItems,
  queueSummary,
} from "@/modules/booking-queue/service";

const enqueueSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(ENQUEUE_MAX_ORDERS),
  via: z.enum(["ORDERS_PAGE", "QUEUE_PAGE", "API"]).optional(),
});

function listQuery(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const states = params.getAll("state").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  return {
    page: Number(params.get("page") ?? 1),
    pageSize: Number(params.get("pageSize") ?? 25),
    states: states.length ? states : undefined,
    source: params.get("source") ?? undefined,
    search: params.get("q") ?? params.get("search") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    runId: params.get("runId") ?? undefined,
  };
}

/**
 * GET  booking-queue            paginated queue items (?state=&source=&q=&from=&to=&runId=&page=&pageSize=)
 * GET  booking-queue/summary    counts per bucket, oldest waiting item, active runs, settings
 * GET  booking-queue/items/:id  one item with its timeline
 * GET  booking-queue/history    every booked shipment, however it was booked (?q=&source=&from=&to=&page=)
 * POST booking-queue/enqueue    { orderIds } add existing orders; validates, never books
 * Off unless the workspace is in BOOKING_QUEUE_ORGS: reads report enabled:false, enqueue is refused.
 */
export async function handleBookingQueueRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  method: string,
  slugs: string[]
) {
  if (slugs[0] !== "booking-queue") return null;
  if (method === "GET" && slugs.length === 1) return listQueueItems(supabase, ctx, listQuery(request));
  if (method === "GET" && slugs[1] === "summary" && slugs.length === 2) return queueSummary(supabase, ctx);
  if (method === "GET" && slugs[1] === "items" && slugs[2] && slugs.length === 3) {
    const id = z.string().uuid().safeParse(slugs[2]);
    if (!id.success) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Queue item not found.");
    return getQueueItem(supabase, ctx, id.data);
  }
  if (method === "GET" && slugs[1] === "history" && slugs.length === 2) {
    const query = listQuery(request);
    return listBookingHistory(supabase, ctx, {
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      source: query.source,
      from: query.from,
      to: query.to,
    });
  }
  if (method === "POST" && slugs[1] === "enqueue" && slugs.length === 2) {
    const parsed = enqueueSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Send 1 to ${ENQUEUE_MAX_ORDERS} order ids.`);
    }
    return enqueueOrders(supabase, ctx, parsed.data.orderIds, { via: parsed.data.via ?? "ORDERS_PAGE" });
  }
  return null;
}
