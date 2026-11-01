import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError, logInfo } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import {
  queueEnrollmentDecision,
  queueSourceOf,
  type EnrollmentBlock,
  type QueueOrderSnapshot,
} from "@/modules/booking-queue/eligibility";
import { bookingQueueEnabledFor } from "@/modules/booking-queue/flags";
import {
  ACTIVE_QUEUE_STATES,
  canTransitionQueueItem,
  isBookingQueueState,
  MEMBER_SETTABLE_STATES,
  QUEUE_SUMMARY_BUCKETS,
  type BookingQueueState,
  type QueueSummaryBucket,
} from "@/modules/booking-queue/state";
import { readCeptSubmitIntentAt } from "@/modules/india-post/booking-intent";
import { validateOrdersForBooking } from "@/modules/india-post/bulk-booking";
import { createShipmentsForOrders } from "@/modules/shipments/service";

export const ENQUEUE_MAX_ORDERS = 500;
const LIST_MAX_PAGE_SIZE = 100;
const SEARCH_ID_LIMIT = 200;
const SYNC_BATCH = 500;

export type EnqueueVia = "ORDERS_PAGE" | "QUEUE_PAGE" | "API";

export type EnqueueSkip = {
  orderId: string;
  orderNumber?: string | null;
  code: EnrollmentBlock | "NOT_FOUND" | "ALREADY_QUEUED" | "SHIPMENT_NOT_CREATED";
  reason: string;
};

export type EnqueueResult = {
  enqueued: Array<{ orderId: string; itemId: string; state: BookingQueueState; warnings: string[] }>;
  skipped: EnqueueSkip[];
};

export function assertBookingQueueEnabled(ctx: TenantContext) {
  if (!bookingQueueEnabledFor(ctx.organizationId)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "Bulk Booking queue is not enabled for this workspace yet.");
  }
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

/**
 * Adds existing orders to the queue. Reuses the order and its live shipment (a DRAFT shipment is
 * created only when the order has none, with no PROCESSING or customer-message side effects).
 * Validation runs immediately and leaves each item INVALID or WAITING_APPROVAL. Nothing is booked.
 */
export async function enqueueOrders(
  supabase: SupabaseClient,
  ctx: TenantContext,
  orderIds: string[],
  options: { via: EnqueueVia } = { via: "ORDERS_PAGE" }
): Promise<EnqueueResult> {
  assertBookingQueueEnabled(ctx);
  const ids = uniqueIds(orderIds);
  if (!ids.length) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Select at least one order.");
  if (ids.length > ENQUEUE_MAX_ORDERS) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Add at most ${ENQUEUE_MAX_ORDERS} orders at a time.`);
  }

  const { data: orderRows, error } = await supabase
    .from("orders")
    .select("id, order_number, source, status, payment_status, shipments(id, status, booked_at, barcode, tracking_number)")
    .eq("organization_id", ctx.organizationId)
    .in("id", ids);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const orders = new Map(((orderRows ?? []) as QueueOrderSnapshot[]).map((row) => [row.id, row]));

  const { data: liveItems, error: liveError } = await supabase
    .from("booking_queue_items")
    .select("order_id")
    .eq("organization_id", ctx.organizationId)
    .in("order_id", ids)
    .in("state", [...ACTIVE_QUEUE_STATES]);
  if (liveError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, liveError.message);
  const queuedOrders = new Set((liveItems ?? []).map((row) => String(row.order_id)));

  const skipped: EnqueueSkip[] = [];
  const accepted: Array<{ order: QueueOrderSnapshot; shipmentId: string | null; warnings: string[] }> = [];
  for (const id of ids) {
    const order = orders.get(id);
    if (!order) {
      skipped.push({ orderId: id, code: "NOT_FOUND", reason: "Order not found in this workspace." });
      continue;
    }
    if (queuedOrders.has(id)) {
      skipped.push({ orderId: id, orderNumber: order.order_number, code: "ALREADY_QUEUED", reason: "Already in the Bulk Booking queue." });
      continue;
    }
    const decision = queueEnrollmentDecision(order);
    if (!decision.ok) {
      skipped.push({ orderId: id, orderNumber: order.order_number, code: decision.code, reason: decision.reason });
      continue;
    }
    accepted.push({ order, shipmentId: decision.shipmentId, warnings: decision.warnings });
  }
  if (!accepted.length) return { enqueued: [], skipped };

  // Orders without a live shipment get a DRAFT one. No booking job, no PROCESSING, no customer message.
  const needShipment = accepted.filter((row) => !row.shipmentId).map((row) => row.order.id);
  if (needShipment.length) {
    const created = await createShipmentsForOrders(supabase, ctx, needShipment, {
      enqueueBooking: false,
      runBookingNow: false,
      setOrderProcessing: false,
    }).catch((createError: unknown) => {
      logError("booking_queue.shipment_create_failed", {
        organizationId: ctx.organizationId,
        message: createError instanceof Error ? createError.message : "unknown",
      });
      return { shipments: [] as Array<{ id: string; order_id: string }> };
    });
    const byOrder = new Map(
      ((created.shipments ?? []) as Array<{ id: string; order_id: string }>).map((row) => [String(row.order_id), String(row.id)])
    );
    for (const row of accepted) {
      if (!row.shipmentId) row.shipmentId = byOrder.get(row.order.id) ?? null;
    }
  }

  const ready = accepted.filter((row) => {
    if (row.shipmentId) return true;
    skipped.push({
      orderId: row.order.id,
      orderNumber: row.order.order_number,
      code: "SHIPMENT_NOT_CREATED",
      reason: "A shipment could not be prepared for this order.",
    });
    return false;
  });

  const inserted: Array<{ orderId: string; itemId: string; warnings: string[] }> = [];
  for (const row of ready) {
    const { data, error: insertError } = await supabase
      .from("booking_queue_items")
      .insert({
        organization_id: ctx.organizationId,
        shipment_id: row.shipmentId,
        order_id: row.order.id,
        source: queueSourceOf(row.order.source),
        enrolled_by: ctx.userId || null,
        enrolled_via: options.via,
      })
      .select("id")
      .single();
    if (insertError || !data) {
      const duplicate = insertError?.code === "23505";
      skipped.push({
        orderId: row.order.id,
        orderNumber: row.order.order_number,
        code: duplicate ? "ALREADY_QUEUED" : "SHIPMENT_NOT_CREATED",
        reason: duplicate ? "Already in the Bulk Booking queue." : insertError?.message || "Could not add the order.",
      });
      continue;
    }
    inserted.push({ orderId: row.order.id, itemId: String(data.id), warnings: row.warnings });
  }
  if (!inserted.length) return { enqueued: [], skipped };

  const states = await validateQueuedOrders(supabase, ctx, inserted.map((row) => ({ orderId: row.orderId, itemId: row.itemId })));
  logInfo("booking_queue.enqueued", {
    organizationId: ctx.organizationId,
    via: options.via,
    enqueued: inserted.length,
    skipped: skipped.length,
  });
  return {
    enqueued: inserted.map((row) => ({ ...row, state: states.get(row.itemId) ?? "PENDING_VALIDATION" })),
    skipped,
  };
}

/**
 * Runs the existing booking validation (the same rules as Orders > Book) and moves each item to
 * INVALID or WAITING_APPROVAL. If validation itself cannot run, items stay PENDING_VALIDATION.
 */
export async function validateQueuedOrders(
  supabase: SupabaseClient,
  ctx: TenantContext,
  items: Array<{ orderId: string; itemId: string }>
) {
  const states = new Map<string, BookingQueueState>();
  if (!items.length) return states;
  let rows: Awaited<ReturnType<typeof validateOrdersForBooking>>["rows"];
  let batchIssues: Awaited<ReturnType<typeof validateOrdersForBooking>>["issues"] = [];
  try {
    const result = await validateOrdersForBooking(supabase, ctx, items.map((item) => item.orderId));
    rows = result.rows;
    batchIssues = result.issues;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Validation could not run.";
    await supabase
      .from("booking_queue_items")
      .update({ last_error: message, last_error_code: "VALIDATION_UNAVAILABLE" })
      .eq("organization_id", ctx.organizationId)
      .in("id", items.map((item) => item.itemId))
      .eq("state", "PENDING_VALIDATION");
    for (const item of items) states.set(item.itemId, "PENDING_VALIDATION");
    return states;
  }
  const byOrder = new Map(rows.map((row) => [String(row.orderId), row]));
  for (const item of items) {
    const row = byOrder.get(item.orderId);
    // validateOrdersForBooking returns no row when origin lookup fails; its batch issues carry the reason.
    const issues = row ? row.issues : batchIssues.filter((issue) => !issue.orderId || issue.orderId === item.orderId);
    const valid = Boolean(row?.valid);
    const next: BookingQueueState = valid ? "WAITING_APPROVAL" : "INVALID";
    const firstError = issues.map((issue) => issue.error).find(Boolean) ?? null;
    const { data } = await supabase
      .from("booking_queue_items")
      .update({
        state: next,
        issues,
        last_error: valid ? null : firstError,
        last_error_code: valid ? null : "VALIDATION_FAILED",
      })
      .eq("id", item.itemId)
      .eq("organization_id", ctx.organizationId)
      .eq("state", "PENDING_VALIDATION")
      .select("state")
      .maybeSingle();
    states.set(item.itemId, data?.state && isBookingQueueState(data.state) ? data.state : "PENDING_VALIDATION");
  }
  return states;
}

export type MirrorShipment = {
  status?: string | null;
  booked_at?: string | null;
  last_error?: string | null;
  last_error_code?: string | null;
  metadata?: unknown;
};

export type MirrorTarget = { state: BookingQueueState; lastError: string | null; lastErrorCode: string | null };

/**
 * What a queue item should become given its shipment, or null to leave it. The shipment is the
 * truth: BOOKED only from booked_at, SUBMITTING only once a submit intent was recorded (the request
 * may have reached India Post), FAILED and RECOVERY_REQUIRED only while the item is in a run.
 */
export function queueMirrorTarget(state: BookingQueueState, shipment: MirrorShipment): MirrorTarget | null {
  const status = String(shipment.status ?? "").toUpperCase();
  if (shipment.booked_at) {
    return canTransitionQueueItem(state, "BOOKED") ? { state: "BOOKED", lastError: null, lastErrorCode: null } : null;
  }
  if (status === "CANCELLED" && MEMBER_SETTABLE_STATES.has(state)) {
    return { state: "CANCELLED", lastError: "The shipment was cancelled.", lastErrorCode: "SHIPMENT_CANCELLED" };
  }
  const inRun = state === "BATCHED" || state === "SUBMITTING";
  if (inRun && status === "RECOVERY_REQUIRED") {
    return {
      state: "RECOVERY_REQUIRED",
      lastError: shipment.last_error || "India Post did not confirm whether this article was booked.",
      lastErrorCode: shipment.last_error_code || "CEPT_UNKNOWN",
    };
  }
  if (inRun && status === "FAILED") {
    return {
      state: "FAILED",
      lastError: shipment.last_error || "India Post did not book this article.",
      lastErrorCode: shipment.last_error_code || "BOOKING_FAILED",
    };
  }
  if (state === "BATCHED" && status === "BOOKING" && readCeptSubmitIntentAt(shipment.metadata)) {
    return { state: "SUBMITTING", lastError: null, lastErrorCode: null };
  }
  return null;
}

const ROLLUP_ACTIVE: ReadonlySet<string> = new Set(["BATCHED", "SUBMITTING"]);

/** Run counts and status from its items. Exported for tests. */
export function rollUpRun(states: string[]) {
  const booked = states.filter((state) => state === "BOOKED").length;
  const failed = states.filter((state) => state === "FAILED").length;
  const recovery = states.filter((state) => state === "RECOVERY_REQUIRED").length;
  const active = states.filter((state) => ROLLUP_ACTIVE.has(state)).length;
  const status = active
    ? "ACTIVE"
    : recovery
      ? "RECOVERY_REQUIRED"
      : failed
        ? "COMPLETED_WITH_ERRORS"
        : "COMPLETED";
  return { status, booked, failed, recovery, active };
}

/**
 * Mirrors shipment outcomes into the queue and rolls up runs: booked anywhere -> BOOKED, booking
 * job results for items in a run, cancelled shipments cancel waiting items. Service role because
 * these are system states; every query is scoped to the one workspace.
 */
export async function syncQueueWithShipments(admin: SupabaseClient, organizationId: string) {
  const { data: items, error } = await admin
    .from("booking_queue_items")
    .select("id, state, shipment_id, run_id")
    .eq("organization_id", organizationId)
    .in("state", [...ACTIVE_QUEUE_STATES])
    .order("updated_at", { ascending: true })
    .limit(SYNC_BATCH);
  if (error || !items?.length) return { booked: 0, cancelled: 0, failed: 0, recovery: 0, runs: 0 };
  const { data: shipments } = await admin
    .from("shipments")
    .select("id, status, booked_at, last_error, last_error_code, metadata")
    .eq("organization_id", organizationId)
    .in("id", items.map((item) => item.shipment_id));
  const byId = new Map((shipments ?? []).map((row) => [String(row.id), row as MirrorShipment]));
  const counts = { booked: 0, cancelled: 0, failed: 0, recovery: 0, runs: 0 };
  const touchedRuns = new Set<string>();
  for (const item of items) {
    const shipment = byId.get(String(item.shipment_id));
    if (!shipment) continue;
    const state = item.state as BookingQueueState;
    const target = queueMirrorTarget(state, shipment);
    if (!target) continue;
    const { data } = await admin
      .from("booking_queue_items")
      .update({ state: target.state, last_error: target.lastError, last_error_code: target.lastErrorCode })
      .eq("id", item.id)
      .eq("organization_id", organizationId)
      .eq("state", state)
      .select("id")
      .maybeSingle();
    if (!data) continue;
    if (item.run_id) touchedRuns.add(String(item.run_id));
    if (target.state === "BOOKED") counts.booked += 1;
    else if (target.state === "CANCELLED") counts.cancelled += 1;
    else if (target.state === "FAILED") counts.failed += 1;
    else if (target.state === "RECOVERY_REQUIRED") counts.recovery += 1;
  }
  for (const runId of touchedRuns) {
    const { data: members } = await admin
      .from("booking_queue_items")
      .select("state")
      .eq("organization_id", organizationId)
      .eq("run_id", runId);
    const rolled = rollUpRun((members ?? []).map((row) => String(row.state)));
    await admin
      .from("booking_runs")
      .update({
        status: rolled.status,
        booked_count: rolled.booked,
        failed_count: rolled.failed,
        recovery_count: rolled.recovery,
        completed_at: rolled.active ? null : new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("organization_id", organizationId)
      .in("status", ["DISPATCHING", "ACTIVE", "RECOVERY_REQUIRED", "COMPLETED_WITH_ERRORS"]);
    counts.runs += 1;
  }
  return counts;
}

export async function syncIfPossible(organizationId: string) {
  if (!hasAdminClient()) return;
  try {
    await syncQueueWithShipments(createAdminClient(), organizationId);
  } catch (error) {
    logError("booking_queue.sync_failed", {
      organizationId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}

export type QueueListQuery = {
  page?: number;
  pageSize?: number;
  /** Queue states, or summary bucket names such as "waitingApproval". */
  states?: string[];
  source?: string;
  search?: string;
  from?: string;
  to?: string;
  runId?: string;
};

export type QueueListItem = {
  id: string;
  state: BookingQueueState;
  source: string;
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
  phone: string | null;
  pincode: string | null;
  paymentStatus: string | null;
  serviceCode: string | null;
  barcode: string | null;
  shipmentId: string;
  shipmentStatus: string | null;
  bookedAt: string | null;
  runId: string | null;
  bulkBatchId: string | null;
  readyAt: string | null;
  issues: unknown[];
  lastError: string | null;
  lastErrorCode: string | null;
  enrolledVia: string;
  createdAt: string;
  updatedAt: string;
};

export function resolveQueueStates(values: string[] | undefined): BookingQueueState[] | null {
  if (!values?.length) return null;
  const states = new Set<BookingQueueState>();
  for (const value of values) {
    if (isBookingQueueState(value)) states.add(value);
    else if (value in QUEUE_SUMMARY_BUCKETS) {
      for (const state of QUEUE_SUMMARY_BUCKETS[value as QueueSummaryBucket]) states.add(state);
    }
  }
  return states.size ? [...states] : [];
}

const ITEM_SELECT =
  "id, state, source, order_id, shipment_id, run_id, bulk_batch_id, ready_at, issues, last_error, last_error_code, enrolled_via, created_at, updated_at, " +
  "orders(order_number, payment_status, customers(name, phone), shipping_address:addresses!shipping_address_id(pincode)), " +
  "shipments(barcode, tracking_number, status, service_code, booked_at)";

type ItemRow = {
  id: string;
  state: string;
  source: string;
  order_id: string;
  shipment_id: string;
  run_id: string | null;
  bulk_batch_id: string | null;
  ready_at: string | null;
  issues: unknown;
  last_error: string | null;
  last_error_code: string | null;
  enrolled_via: string;
  created_at: string;
  updated_at: string;
  orders?: {
    order_number?: string | null;
    payment_status?: string | null;
    customers?: { name?: string | null; phone?: string | null } | null;
    shipping_address?: { pincode?: string | null } | null;
  } | null;
  shipments?: {
    barcode?: string | null;
    tracking_number?: string | null;
    status?: string | null;
    service_code?: string | null;
    booked_at?: string | null;
  } | null;
};

export function publicQueueItem(row: ItemRow): QueueListItem {
  return {
    id: row.id,
    state: isBookingQueueState(row.state) ? row.state : "PENDING_VALIDATION",
    source: row.source,
    orderId: row.order_id,
    orderNumber: row.orders?.order_number ?? null,
    customerName: row.orders?.customers?.name ?? null,
    phone: row.orders?.customers?.phone ?? null,
    pincode: row.orders?.shipping_address?.pincode ?? null,
    paymentStatus: row.orders?.payment_status ?? null,
    serviceCode: row.shipments?.service_code ?? null,
    barcode: row.shipments?.barcode || row.shipments?.tracking_number || null,
    shipmentId: row.shipment_id,
    shipmentStatus: row.shipments?.status ?? null,
    bookedAt: row.shipments?.booked_at ?? null,
    runId: row.run_id,
    bulkBatchId: row.bulk_batch_id,
    readyAt: row.ready_at,
    issues: Array.isArray(row.issues) ? row.issues : [],
    lastError: row.last_error,
    lastErrorCode: row.last_error_code,
    enrolledVia: row.enrolled_via,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Order and shipment ids matching a search across order number, customer and barcode. */
export async function searchTargets(supabase: SupabaseClient, organizationId: string, search: string) {
  const term = search.replace(/[%_,()]/g, " ").trim();
  if (!term) return null;
  const like = `%${term}%`;
  const [byNumber, byCustomer, byBarcode] = await Promise.all([
    supabase.from("orders").select("id").eq("organization_id", organizationId).ilike("order_number", like).limit(SEARCH_ID_LIMIT),
    supabase
      .from("customers")
      .select("id")
      .eq("organization_id", organizationId)
      .or(`name.ilike.${like},phone.ilike.${like}`)
      .limit(SEARCH_ID_LIMIT),
    supabase
      .from("shipments")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("barcode", `%${term.toUpperCase()}%`)
      .limit(SEARCH_ID_LIMIT),
  ]);
  const customerIds = (byCustomer.data ?? []).map((row) => String(row.id));
  const byCustomerOrders = customerIds.length
    ? await supabase.from("orders").select("id").eq("organization_id", organizationId).in("customer_id", customerIds).limit(SEARCH_ID_LIMIT)
    : { data: [] as Array<{ id: string }> };
  return {
    orderIds: [...new Set([...(byNumber.data ?? []), ...(byCustomerOrders.data ?? [])].map((row) => String(row.id)))],
    shipmentIds: (byBarcode.data ?? []).map((row) => String(row.id)),
  };
}

export async function listQueueItems(supabase: SupabaseClient, ctx: TenantContext, query: QueueListQuery = {}) {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const pageSize = Math.min(LIST_MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(query.pageSize) || 25)));
  const empty = { enabled: true, items: [] as QueueListItem[], page, pageSize, total: 0 };
  if (!bookingQueueEnabledFor(ctx.organizationId)) return { ...empty, enabled: false };
  await syncIfPossible(ctx.organizationId);

  let request = supabase
    .from("booking_queue_items")
    .select(ITEM_SELECT, { count: "exact" })
    .eq("organization_id", ctx.organizationId);
  const states = resolveQueueStates(query.states);
  if (states) {
    if (!states.length) return empty;
    request = request.in("state", states);
  }
  if (query.source) request = request.eq("source", queueSourceOf(query.source));
  if (query.runId) request = request.eq("run_id", query.runId);
  if (query.from) request = request.gte("created_at", query.from);
  if (query.to) request = request.lte("created_at", query.to);
  if (query.search?.trim()) {
    const targets = await searchTargets(supabase, ctx.organizationId, query.search);
    if (targets) {
      const clauses = [
        targets.orderIds.length ? `order_id.in.(${targets.orderIds.join(",")})` : "",
        targets.shipmentIds.length ? `shipment_id.in.(${targets.shipmentIds.join(",")})` : "",
      ].filter(Boolean);
      if (!clauses.length) return empty;
      request = request.or(clauses.join(","));
    }
  }
  const from = (page - 1) * pageSize;
  const { data, error, count } = await request.order("updated_at", { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return {
    enabled: true,
    items: ((data ?? []) as unknown as ItemRow[]).map(publicQueueItem),
    page,
    pageSize,
    total: count ?? 0,
  };
}

export type QueueSummary = {
  enabled: boolean;
  counts: Record<QueueSummaryBucket | "total", number>;
  oldestReadyAt: string | null;
  activeRuns: number;
  settings: { mode: "MANUAL" | "AUTOMATIC"; batchThreshold: number; maxWaitMinutes: number | null; paused: boolean };
};

const DEFAULT_SETTINGS: QueueSummary["settings"] = { mode: "MANUAL", batchThreshold: 50, maxWaitMinutes: null, paused: false };

function emptyCounts(): QueueSummary["counts"] {
  const counts = { total: 0 } as QueueSummary["counts"];
  for (const bucket of Object.keys(QUEUE_SUMMARY_BUCKETS) as QueueSummaryBucket[]) counts[bucket] = 0;
  return counts;
}

export async function queueSummary(supabase: SupabaseClient, ctx: TenantContext): Promise<QueueSummary> {
  if (!bookingQueueEnabledFor(ctx.organizationId)) {
    return { enabled: false, counts: emptyCounts(), oldestReadyAt: null, activeRuns: 0, settings: DEFAULT_SETTINGS };
  }
  await syncIfPossible(ctx.organizationId);
  const countState = async (states: readonly BookingQueueState[]) => {
    const { count, error } = await supabase
      .from("booking_queue_items")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.organizationId)
      .in("state", [...states]);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    return count ?? 0;
  };
  const buckets = Object.entries(QUEUE_SUMMARY_BUCKETS) as Array<[QueueSummaryBucket, readonly BookingQueueState[]]>;
  const [bucketCounts, oldest, runs, settings] = await Promise.all([
    Promise.all(buckets.map(([, states]) => countState(states))),
    supabase
      .from("booking_queue_items")
      .select("ready_at")
      .eq("organization_id", ctx.organizationId)
      .eq("state", "READY_FOR_BOOKING")
      .order("ready_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("booking_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.organizationId)
      .in("status", ["DISPATCHING", "ACTIVE"]),
    supabase
      .from("booking_automation_settings")
      .select("mode, batch_threshold, max_wait_minutes, paused_at")
      .eq("organization_id", ctx.organizationId)
      .maybeSingle(),
  ]);
  const counts = emptyCounts();
  buckets.forEach(([bucket], index) => {
    counts[bucket] = bucketCounts[index] ?? 0;
    counts.total += counts[bucket];
  });
  return {
    enabled: true,
    counts,
    oldestReadyAt: (oldest.data?.ready_at as string | undefined) ?? null,
    activeRuns: runs.count ?? 0,
    settings: settings.data
      ? {
          mode: settings.data.mode === "AUTOMATIC" ? "AUTOMATIC" : "MANUAL",
          batchThreshold: Number(settings.data.batch_threshold) || DEFAULT_SETTINGS.batchThreshold,
          maxWaitMinutes: settings.data.max_wait_minutes == null ? null : Number(settings.data.max_wait_minutes),
          paused: Boolean(settings.data.paused_at),
        }
      : DEFAULT_SETTINGS,
  };
}

export type QueueItemEvent = {
  id: number;
  fromState: string | null;
  toState: string;
  actorId: string | null;
  reason: string | null;
  runId: string | null;
  createdAt: string;
};

/** One queue item with its timeline, for the detail drawer. */
export async function getQueueItem(supabase: SupabaseClient, ctx: TenantContext, itemId: string) {
  assertBookingQueueEnabled(ctx);
  const { data, error } = await supabase
    .from("booking_queue_items")
    .select(ITEM_SELECT)
    .eq("organization_id", ctx.organizationId)
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Queue item not found.");
  const { data: events, error: eventsError } = await supabase
    .from("booking_queue_events")
    .select("id, from_state, to_state, actor_id, reason, run_id, created_at")
    .eq("organization_id", ctx.organizationId)
    .eq("item_id", itemId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (eventsError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, eventsError.message);
  return {
    item: publicQueueItem(data as unknown as ItemRow),
    events: (events ?? []).map(
      (row): QueueItemEvent => ({
        id: Number(row.id),
        fromState: (row.from_state as string | null) ?? null,
        toState: String(row.to_state),
        actorId: (row.actor_id as string | null) ?? null,
        reason: (row.reason as string | null) ?? null,
        runId: (row.run_id as string | null) ?? null,
        createdAt: String(row.created_at),
      })
    ),
  };
}

export type BookingHistoryQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  source?: string;
  from?: string;
  to?: string;
};

export type BookingHistoryRow = {
  shipmentId: string;
  orderId: string | null;
  orderNumber: string | null;
  source: string;
  customerName: string | null;
  phone: string | null;
  pincode: string | null;
  serviceCode: string | null;
  barcode: string | null;
  shipmentStatus: string | null;
  bookedAt: string;
  queueItemId: string | null;
  runId: string | null;
  bookedVia: "QUEUE" | "DIRECT";
};

type HistoryShipmentRow = {
  id: string;
  order_id: string | null;
  barcode: string | null;
  tracking_number: string | null;
  status: string | null;
  service_code: string | null;
  booked_at: string;
  orders?: {
    order_number?: string | null;
    source?: string | null;
    customers?: { name?: string | null; phone?: string | null } | null;
    shipping_address?: { pincode?: string | null } | null;
  } | null;
};

type HistoryItemRow = { id: string; shipment_id: string; run_id: string | null; source: string; state: string };

/** Picks the queue item that recorded a booking, else the newest one, per shipment. */
export function historyItemsByShipment(items: HistoryItemRow[]) {
  const byShipment = new Map<string, HistoryItemRow>();
  for (const item of items) {
    const key = String(item.shipment_id);
    const current = byShipment.get(key);
    if (!current || (item.state === "BOOKED" && current.state !== "BOOKED")) byShipment.set(key, item);
  }
  return byShipment;
}

export function publicHistoryRow(row: HistoryShipmentRow, item: HistoryItemRow | undefined): BookingHistoryRow {
  return {
    shipmentId: row.id,
    orderId: row.order_id,
    orderNumber: row.orders?.order_number ?? null,
    source: item?.source ?? queueSourceOf(row.orders?.source),
    customerName: row.orders?.customers?.name ?? null,
    phone: row.orders?.customers?.phone ?? null,
    pincode: row.orders?.shipping_address?.pincode ?? null,
    serviceCode: row.service_code,
    barcode: row.barcode || row.tracking_number || null,
    shipmentStatus: row.status,
    bookedAt: row.booked_at,
    queueItemId: item?.id ?? null,
    runId: item?.run_id ?? null,
    bookedVia: item?.run_id ? "QUEUE" : "DIRECT",
  };
}

/**
 * Every shipment India Post booked for this workspace, however it was booked. A read model over
 * shipments: bookings from the Orders page appear without queue rows or new booking requests.
 */
export async function listBookingHistory(supabase: SupabaseClient, ctx: TenantContext, query: BookingHistoryQuery = {}) {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const pageSize = Math.min(LIST_MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(query.pageSize) || 25)));
  const empty = { enabled: true, items: [] as BookingHistoryRow[], page, pageSize, total: 0 };
  if (!bookingQueueEnabledFor(ctx.organizationId)) return { ...empty, enabled: false };

  const source = query.source ? queueSourceOf(query.source) : null;
  // EXCEL is a queue source, not an order source: those orders are stored as MANUAL.
  const orderSource = source && source !== "EXCEL" ? source : null;
  const orderEmbed = orderSource ? "orders!inner" : "orders";
  let request = supabase
    .from("shipments")
    .select(
      `id, order_id, barcode, tracking_number, status, service_code, booked_at, ${orderEmbed}(order_number, source, customers(name, phone), shipping_address:addresses!shipping_address_id(pincode))`,
      { count: "exact" }
    )
    .eq("organization_id", ctx.organizationId)
    .not("booked_at", "is", null);
  if (orderSource) request = request.eq("orders.source", orderSource);
  if (query.from) request = request.gte("booked_at", query.from);
  if (query.to) request = request.lte("booked_at", query.to);
  if (source === "EXCEL") {
    const { data: excelItems } = await supabase
      .from("booking_queue_items")
      .select("shipment_id")
      .eq("organization_id", ctx.organizationId)
      .eq("source", "EXCEL")
      .eq("state", "BOOKED")
      .limit(SEARCH_ID_LIMIT * 5);
    const ids = (excelItems ?? []).map((row) => String(row.shipment_id));
    if (!ids.length) return empty;
    request = request.in("id", ids);
  }
  if (query.search?.trim()) {
    const targets = await searchTargets(supabase, ctx.organizationId, query.search);
    if (targets) {
      const clauses = [
        targets.orderIds.length ? `order_id.in.(${targets.orderIds.join(",")})` : "",
        targets.shipmentIds.length ? `id.in.(${targets.shipmentIds.join(",")})` : "",
      ].filter(Boolean);
      if (!clauses.length) return empty;
      request = request.or(clauses.join(","));
    }
  }
  const from = (page - 1) * pageSize;
  const { data, error, count } = await request.order("booked_at", { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const rows = (data ?? []) as unknown as HistoryShipmentRow[];
  const { data: items } = rows.length
    ? await supabase
        .from("booking_queue_items")
        .select("id, shipment_id, run_id, source, state")
        .eq("organization_id", ctx.organizationId)
        .in("shipment_id", rows.map((row) => row.id))
        .order("created_at", { ascending: false })
    : { data: [] as HistoryItemRow[] };
  const itemByShipment = historyItemsByShipment((items ?? []) as HistoryItemRow[]);
  return {
    enabled: true,
    items: rows.map((row) => publicHistoryRow(row, itemByShipment.get(row.id))),
    page,
    pageSize,
    total: count ?? 0,
  };
}
