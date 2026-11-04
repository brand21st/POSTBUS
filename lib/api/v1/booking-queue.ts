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
import { NextResponse } from "next/server";
import { bookedArticleDetailsExport, bookedArticleDetailsPlan, BOOKED_EXPORT_MAX } from "@/modules/booking-queue/export";
import { getBookingAutomationSettings, saveBookingAutomationSettings } from "@/modules/booking-queue/settings";
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

const exportSchema = z.object({
  shipmentIds: z.array(z.string().uuid()).max(BOOKED_EXPORT_MAX).optional(),
  q: z.string().max(200).optional(),
  source: z.string().max(40).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  part: z.number().int().min(1).optional(),
});

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
 * GET  booking-queue/settings   automation settings (mode, sources, batch size, maximum wait, paused)
 * PATCH booking-queue/settings  { version, ... } save; owners and admins only
 * POST booking-queue/export/plan  { shipmentIds? | q, source, from, to } files an export would produce
 * POST booking-queue/export       { ..., part } one India Post ArticleDetails workbook of booked shipments
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
  if (slugs[1] === "settings" && slugs.length === 2) {
    if (method === "GET") return getBookingAutomationSettings(supabase, ctx);
    if (method === "PATCH") return saveBookingAutomationSettings(supabase, ctx, await request.json().catch(() => ({})));
  }
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
  if (method === "POST" && slugs[1] === "export") {
    const input = await body(request, exportSchema, "Choose the shipments or filters to export.");
    const query = { shipmentIds: input.shipmentIds, search: input.q, source: input.source, from: input.from, to: input.to };
    if (slugs[2] === "plan" && slugs.length === 3) return bookedArticleDetailsPlan(supabase, ctx, query);
    if (slugs.length === 2) {
      const file = await bookedArticleDetailsExport(supabase, ctx, { ...query, part: input.part });
      return new NextResponse(Buffer.from(file.bytes), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${file.filename}"`,
        },
      });
    }
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
