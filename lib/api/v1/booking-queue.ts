import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import {
  approveAllWaiting,
  approveItems,
  dispatchItems,
  excludeItems,
  QUEUE_ACTION_MAX_ITEMS,
  revalidateItems,
} from "@/modules/booking-queue/actions";
import {
  ENQUEUE_MAX_ORDERS,
  enqueueOrders,
  getQueueItem,
  listBookingHistory,
  listQueueItems,
  queueSummary,
} from "@/modules/booking-queue/service";

const itemIdsSchema = z.object({ itemIds: z.array(z.string().uuid()).min(1).max(QUEUE_ACTION_MAX_ITEMS) });
const approveSchema = z.union([
  itemIdsSchema,
  z.object({ all: z.literal(true), expectedCount: z.number().int().min(0) }),
]);
const dispatchSchema = itemIdsSchema.extend({ idempotencyKey: z.string().min(8).max(120) });

async function body<T>(request: NextRequest, schema: z.ZodType<T>, message: string): Promise<T> {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new AppError(ERROR_CODES.VALIDATION_ERROR, message);
  return parsed.data;
}

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
 * POST booking-queue/approve    { itemIds } or { all: true, expectedCount } -> ready to book; never books
 * POST booking-queue/exclude    { itemIds } leave orders out of booking
 * POST booking-queue/revalidate { itemIds } check orders again
 * POST booking-queue/dispatch   { itemIds, idempotencyKey } book approved orders with India Post
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
  if (method === "POST" && slugs.length === 2) {
    const ids = `Send 1 to ${QUEUE_ACTION_MAX_ITEMS} queue item ids.`;
    if (slugs[1] === "approve") {
      const input = await body(request, approveSchema, ids);
      return "all" in input ? approveAllWaiting(supabase, ctx, input.expectedCount) : approveItems(supabase, ctx, input.itemIds);
    }
    if (slugs[1] === "exclude") return excludeItems(supabase, ctx, (await body(request, itemIdsSchema, ids)).itemIds);
    if (slugs[1] === "revalidate") return revalidateItems(supabase, ctx, (await body(request, itemIdsSchema, ids)).itemIds);
    if (slugs[1] === "dispatch") return dispatchItems(supabase, ctx, await body(request, dispatchSchema, ids));
  }
  return null;
}
