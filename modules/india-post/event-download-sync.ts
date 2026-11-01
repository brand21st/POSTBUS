import type { SupabaseClient } from "@supabase/supabase-js";
import { logError, logInfo } from "@/lib/logger";
import {
  ingestBulkTrackingArticle,
  matchingBulkTrackingArticle,
  snapshotFromShipmentRow,
  TRACKING_POLL_STATUSES,
  type BulkTrackingArticle,
  type TrackingIngestSource,
} from "@/modules/india-post/apply-tracking";
import { isIndiaPostEventDownloadOpenForOrg } from "@/modules/india-post/event-download-flags";
import { withEventDownloadLeases } from "@/modules/india-post/event-download-lock";
import { indiaPostEventCustomerId, indiaPostEventDates } from "@/modules/india-post/event-download";
import { IndiaPostProvider } from "@/modules/india-post/provider";
import {
  INDIA_POST_EVENT_DOWNLOAD_OVERLAP_DAYS,
  INDIA_POST_EVENT_DOWNLOAD_REFRESH_COOLDOWN_MS,
  indiaPostEventDownloadLookbackDays,
  indiaPostEventDownloadLookbackIntervalMs,
} from "@/modules/india-post/spec";
import { trackingRefreshMessage } from "@/modules/india-post/tracking-refresh-messages";
import { hardFailureError } from "@/modules/india-post/tracking-outcomes";
import {
  bulkArticleNumber,
  classifyRequestedArticles,
  normalizeArticleNumber,
} from "@/modules/india-post/tracking-response";
import {
  enqueueTrackingStageSideEffects,
  shouldEnqueueTrackingStageSideEffects,
} from "@/modules/india-post/tracking-effects";
import type { TrackingAvailability } from "@/types/api";

type ShipmentRow = {
  id: string;
  barcode: string | null;
  status: string | null;
  order_id: string | null;
  operational_status: string | null;
  last_event_at: string | null;
  ndr_attempt_count: number | null;
  rto_initiated_at: string | null;
  last_tracked_at?: string | null;
};

export type EventDownloadSyncMode = "overlap" | "lookback";

export type EventDownloadSyncResult = {
  availability: TrackingAvailability;
  liveTracking: "ok" | "unavailable" | "not_connected" | "cached";
  liveMessage: string | null;
  eventsInserted: number;
  eventsDuplicate: number;
  articlesReceived: number;
  articlesMatched: number;
  datesFetched: string[];
  skippedFetch: boolean;
  matchingArticle: BulkTrackingArticle | null;
  httpStatus: number | null;
  emptyNoContent: boolean;
  /** Which CEPT feed produced this result. */
  trackingSource: "tracking-api" | "event-download";
};

export function shouldRunHistoricalLookback(lastLookbackSuccessAt: string | null | undefined, now = Date.now()) {
  if (!lastLookbackSuccessAt) return true;
  const at = Date.parse(lastLookbackSuccessAt);
  if (!Number.isFinite(at)) return true;
  return now - at >= indiaPostEventDownloadLookbackIntervalMs();
}

function availabilityForFailure(status: number | undefined, hasStoredEvents: boolean): TrackingAvailability {
  if (hasStoredEvents) return "TRACKING_DATA_STALE";
  if (status === 401 || status === 403) return "TRACKING_PROVIDER_UNAUTHORIZED";
  return "TRACKING_TEMPORARILY_UNAVAILABLE";
}

async function loadOrgShipments(
  supabase: SupabaseClient,
  organizationId: string,
  barcodes?: string[]
) {
  let query = supabase
    .from("shipments")
    .select(
      "id, barcode, status, order_id, operational_status, last_event_at, last_tracked_at, ndr_attempt_count, rto_initiated_at"
    )
    .eq("organization_id", organizationId)
    .not("barcode", "is", null)
    .in("status", [...TRACKING_POLL_STATUSES])
    .or("operational_status.is.null,operational_status.neq.RTO_DELIVERED")
    .limit(5000);
  if (barcodes?.length) {
    query = query.in("barcode", barcodes);
  }
  const { data } = await query;
  return (data ?? []) as ShipmentRow[];
}

async function readCheckpoint(
  supabase: SupabaseClient,
  organizationId: string,
  custId: string,
  eventDate: string
) {
  const { data } = await supabase
    .from("tracking_sync_checkpoints")
    .select("last_success_at, last_attempt_at, status, http_status")
    .eq("organization_id", organizationId)
    .eq("cust_id", custId)
    .eq("event_code", "LE")
    .eq("event_date", eventDate)
    .maybeSingle();
  return data;
}

export async function readLookbackState(
  supabase: SupabaseClient,
  organizationId: string,
  custId: string
) {
  const { data } = await supabase
    .from("tracking_lookback_state")
    .select("last_lookback_success_at, last_lookback_attempt_at, last_lookback_http_status")
    .eq("organization_id", organizationId)
    .eq("cust_id", custId)
    .eq("event_code", "LE")
    .maybeSingle();
  return data;
}

async function writeLookbackState(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    custId: string;
    httpStatus: number | null;
    success: boolean;
  }
) {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    organization_id: input.organizationId,
    cust_id: input.custId,
    event_code: "LE",
    last_lookback_attempt_at: now,
    last_lookback_http_status: input.httpStatus,
    updated_at: now,
  };
  if (input.success) row.last_lookback_success_at = now;
  await supabase.from("tracking_lookback_state").upsert(row, {
    onConflict: "organization_id,cust_id,event_code",
  });
}

async function writeCheckpoint(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    custId: string;
    eventDate: string;
    status: string;
    httpStatus: number | null;
    eventsReceived: number;
    eventsMatched: number;
    success: boolean;
  }
) {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    organization_id: input.organizationId,
    cust_id: input.custId,
    event_code: "LE",
    event_date: input.eventDate,
    status: input.status,
    http_status: input.httpStatus,
    events_received: input.eventsReceived,
    events_matched: input.eventsMatched,
    last_attempt_at: now,
    updated_at: now,
  };
  if (input.success) row.last_success_at = now;
  await supabase.from("tracking_sync_checkpoints").upsert(row, {
    onConflict: "organization_id,cust_id,event_code,event_date",
  });
}

async function datesDueForFetch(
  supabase: SupabaseClient,
  organizationId: string,
  custId: string,
  dates: string[],
  cooldownMs: number
) {
  const due: string[] = [];
  for (const eventDate of dates) {
    const row = await readCheckpoint(supabase, organizationId, custId, eventDate);
    const lastSuccess = row?.last_success_at ? Date.parse(row.last_success_at) : 0;
    if (lastSuccess && Date.now() - lastSuccess < cooldownMs) continue;
    due.push(eventDate);
  }
  return due;
}

function emptyResult(
  availability: TrackingAvailability,
  liveTracking: EventDownloadSyncResult["liveTracking"] = "unavailable"
): EventDownloadSyncResult {
  return {
    availability,
    liveTracking,
    liveMessage: trackingRefreshMessage({
      skippedFetch: liveTracking === "cached",
      eventsInserted: 0,
      unauthorized: availability === "TRACKING_PROVIDER_UNAUTHORIZED",
      unavailable: availability === "TRACKING_TEMPORARILY_UNAVAILABLE" || availability === "TRACKING_DATA_STALE",
    }),
    eventsInserted: 0,
    eventsDuplicate: 0,
    articlesReceived: 0,
    articlesMatched: 0,
    datesFetched: [],
    skippedFetch: liveTracking === "cached",
    matchingArticle: null,
    httpStatus: null,
    emptyNoContent: false,
    trackingSource: "event-download",
  };
}

export async function runOrganizationEventDownloadSync(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    provider: IndiaPostProvider;
    bulkCustomerId?: string | null;
    mode?: EventDownloadSyncMode;
    requestedBarcodes?: string[];
    source?: TrackingIngestSource;
    cooldownMs?: number;
    hasStoredEvents?: boolean;
  }
): Promise<EventDownloadSyncResult> {
  const organizationId = input.organizationId;
  const mode = input.mode ?? "overlap";

  // TNT01/TNT02 first. The Event Download allowlist gates only the fallback feed.
  const viaApi = await runTrackingApiSync(supabase, input);
  if (viaApi) return viaApi;

  if (!isIndiaPostEventDownloadOpenForOrg(organizationId)) {
    return emptyResult(input.hasStoredEvents ? "TRACKING_DATA_STALE" : "TRACKING_TEMPORARILY_UNAVAILABLE");
  }

  const customerId = indiaPostEventCustomerId(input.bulkCustomerId);
  if (!customerId) {
    const error = new Error("India Post customer ID is missing or invalid for event download.");
    (error as { status?: number; code?: string }).status = 400;
    (error as { status?: number; code?: string }).code = "TRACKING_CUSTOMER_ID_INVALID";
    throw error;
  }

  const lookbackDays = mode === "lookback" ? indiaPostEventDownloadLookbackDays() : INDIA_POST_EVENT_DOWNLOAD_OVERLAP_DAYS;
  const dates = indiaPostEventDates(lookbackDays);
  const cooldownMs = input.cooldownMs ?? INDIA_POST_EVENT_DOWNLOAD_REFRESH_COOLDOWN_MS;
  let dueDates = await datesDueForFetch(supabase, organizationId, customerId, dates, cooldownMs);
  const started = Date.now();

  if (!dueDates.length) {
    logInfo("india_post.event_download.cooldown", { organizationId, customerId, mode });
    const cached = emptyResult(
      input.hasStoredEvents ? "TRACKING_AVAILABLE" : "TRACKING_NO_SCANS_YET",
      "cached"
    );
    return { ...cached, liveMessage: trackingRefreshMessage({ skippedFetch: true, eventsInserted: 0 }) };
  }

  // Assigned inside the lease callback, so keep the declared type instead of narrowing to null.
  let downloaded = null as Awaited<ReturnType<IndiaPostProvider["downloadLatestEvents"]>> | null;
  let heldDates: string[] = [];
  try {
    await withEventDownloadLeases(
      supabase,
      {
        organizationId,
        custId: customerId,
        eventDates: dueDates,
        allowMissingRpc: process.env.NODE_ENV !== "production",
      },
      async (leased) => {
        heldDates = leased;
        dueDates = await datesDueForFetch(supabase, organizationId, customerId, leased, cooldownMs);
        if (!dueDates.length) return;
        downloaded = await input.provider.downloadLatestEvents(dueDates);
      }
    );
  } catch (error) {
    const status = (error as { status?: number }).status;
    logError("india_post.event_download.failed", {
      organizationId,
      httpStatus: status ?? null,
      durationMs: Date.now() - started,
      mode,
    });
    throw error;
  }

  if (!downloaded || !dueDates.length) {
    const cached = emptyResult(
      input.hasStoredEvents ? "TRACKING_AVAILABLE" : "TRACKING_NO_SCANS_YET",
      "cached"
    );
    return { ...cached, liveMessage: trackingRefreshMessage({ skippedFetch: true, eventsInserted: 0 }) };
  }

  const httpStatus = downloaded.hardFailure?.status ?? downloaded.httpStatus ?? 200;
  if (downloaded.hardFailure?.status === 403) {
    for (const eventDate of dueDates) {
      await writeCheckpoint(supabase, {
        organizationId,
        custId: customerId,
        eventDate,
        status: "UNAUTHORIZED",
        httpStatus: 403,
        eventsReceived: 0,
        eventsMatched: 0,
        success: false,
      });
    }
    if (mode === "lookback") {
      await writeLookbackState(supabase, {
        organizationId,
        custId: customerId,
        httpStatus: 403,
        success: false,
      });
    }
    throw Object.assign(new Error(trackingRefreshMessage({ unauthorized: true })), {
      status: 403,
      code: "HTTP_403",
    });
  }

  const shipments = await loadOrgShipments(supabase, organizationId, input.requestedBarcodes);
  const shipmentByBarcode = new Map(
    shipments
      .filter((row) => row.barcode)
      .map((row) => [normalizeArticleNumber(row.barcode), row] as const)
  );

  let eventsInserted = 0;
  let eventsDuplicate = 0;
  let articlesMatched = 0;
  for (const article of downloaded.articles) {
    const key = normalizeArticleNumber(bulkArticleNumber(article));
    const shipment = shipmentByBarcode.get(key);
    if (!shipment) continue;
    articlesMatched += 1;
    const ingested = await ingestTrackedArticle(supabase, {
      organizationId,
      shipment,
      article,
      source: input.source ?? "event_download",
    });
    eventsInserted += ingested.eventsInserted;
    eventsDuplicate += ingested.eventsDuplicate;
  }

  const emptyNoContent = Boolean(downloaded.emptyNoContent) || httpStatus === 204;
  for (const eventDate of dueDates) {
    await writeCheckpoint(supabase, {
      organizationId,
      custId: customerId,
      eventDate,
      status: downloaded.hardFailure ? "FAILED" : "SUCCEEDED",
      httpStatus,
      eventsReceived: downloaded.articles.length,
      eventsMatched: articlesMatched,
      success: !downloaded.hardFailure,
    });
  }
  if (mode === "lookback") {
    await writeLookbackState(supabase, {
      organizationId,
      custId: customerId,
      httpStatus,
      success: !downloaded.hardFailure,
    });
  }

  const requested = input.requestedBarcodes?.[0] ?? null;
  const matchingArticle = requested ? matchingBulkTrackingArticle(downloaded.articles, requested) : null;
  const liveMessage = trackingRefreshMessage({
    httpStatus,
    eventsInserted,
    skippedFetch: false,
  });
  logInfo("india_post.event_download.ok", {
    organizationId,
    mode,
    eventDates: dueDates,
    heldDates,
    httpStatus,
    eventsReceived: downloaded.articles.length,
    eventsMatched: articlesMatched,
    eventsInserted,
    durationMs: Date.now() - started,
  });

  return {
    availability: eventsInserted > 0 || matchingArticle?.tracking_details?.length
      ? "TRACKING_AVAILABLE"
      : "TRACKING_NO_SCANS_YET",
    liveTracking: downloaded.hardFailure ? "unavailable" : "ok",
    liveMessage,
    eventsInserted,
    eventsDuplicate,
    articlesReceived: downloaded.articles.length,
    articlesMatched,
    datesFetched: dueDates,
    skippedFetch: false,
    matchingArticle,
    httpStatus,
    emptyNoContent,
    trackingSource: "event-download",
  };
}

async function ingestTrackedArticle(
  supabase: SupabaseClient,
  input: { organizationId: string; shipment: ShipmentRow; article: BulkTrackingArticle; source: TrackingIngestSource }
) {
  const ingested = await ingestBulkTrackingArticle(supabase, {
    organizationId: input.organizationId,
    shipment: snapshotFromShipmentRow(input.shipment, input.organizationId),
    article: input.article,
    source: input.source,
  });
  if (
    shouldEnqueueTrackingStageSideEffects({
      eventsInserted: ingested.eventsInserted,
      whatsappEvents: ingested.whatsappEvents,
      orderStatus: ingested.orderStatus,
    })
  ) {
    await enqueueTrackingStageSideEffects(supabase, {
      organizationId: input.organizationId,
      shipmentId: input.shipment.id,
      orderId: input.shipment.order_id,
      orderStatus: ingested.orderStatus,
      events: ingested.whatsappEvents,
      notices: ingested.notices,
    });
  }
  return ingested;
}

/**
 * TNT01/TNT02 per-AWB tracking for the org's open shipments.
 * Returns null when CEPT denies the tracking APIs (403) so the caller uses Event Download.
 */
async function runTrackingApiSync(
  supabase: SupabaseClient,
  input: Parameters<typeof runOrganizationEventDownloadSync>[1]
): Promise<EventDownloadSyncResult | null> {
  const organizationId = input.organizationId;
  if (input.provider.trackingApiForbidden()) return null;

  const cached = (): EventDownloadSyncResult => ({
    ...emptyResult(input.hasStoredEvents ? "TRACKING_AVAILABLE" : "TRACKING_NO_SCANS_YET", "cached"),
    liveMessage: trackingRefreshMessage({ skippedFetch: true, eventsInserted: 0 }),
    trackingSource: "tracking-api",
  });
  // Lookback backfills the date-based Event Download feed. TNT already returns full history per AWB.
  if (input.mode === "lookback") return cached();

  const cooldownMs = input.cooldownMs ?? INDIA_POST_EVENT_DOWNLOAD_REFRESH_COOLDOWN_MS;
  const shipments = (await loadOrgShipments(supabase, organizationId, input.requestedBarcodes)).filter((row) => {
    const last = row.last_tracked_at ? Date.parse(row.last_tracked_at) : 0;
    return !last || Date.now() - last >= cooldownMs;
  });
  if (!shipments.length) return cached();

  const started = Date.now();
  const fetched = await input.provider.trackViaTrackingApi(shipments.map((row) => String(row.barcode)));

  if (fetched.forbidden) return null;

  let eventsInserted = 0;
  let eventsDuplicate = 0;
  let articlesMatched = 0;
  const untracked: string[] = [];
  const barcodes = shipments.map((row) => String(row.barcode));
  const matched = classifyRequestedArticles(fetched.articles, barcodes).rows;
  const articleByBarcode = new Map(matched.map((row) => [normalizeArticleNumber(row.barcode), row.article] as const));
  for (const shipment of shipments) {
    const article = articleByBarcode.get(normalizeArticleNumber(shipment.barcode));
    if (!article) {
      untracked.push(shipment.id);
      continue;
    }
    articlesMatched += 1;
    const ingested = await ingestTrackedArticle(supabase, {
      organizationId,
      shipment,
      article,
      source: input.source === "public" ? "public" : "bulk",
    });
    eventsInserted += ingested.eventsInserted;
    eventsDuplicate += ingested.eventsDuplicate;
  }
  // Accepted lookups with no scans still advance the poll clock so CEPT is not asked again immediately.
  if (untracked.length && fetched.batchesSucceeded > 0) {
    await supabase
      .from("shipments")
      .update({ last_tracked_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .in("id", untracked);
  }

  if (fetched.hardFailure && fetched.batchesSucceeded === 0) {
    logError("india_post.tracking_api.failed", {
      organizationId,
      httpStatus: fetched.hardFailure.status ?? null,
      durationMs: Date.now() - started,
    });
    throw hardFailureError(fetched.hardFailure);
  }

  const requested = input.requestedBarcodes?.[0] ?? null;
  const matchingArticle = requested ? articleByBarcode.get(normalizeArticleNumber(requested)) ?? null : null;
  const httpStatus = fetched.httpStatus ?? 200;
  logInfo("india_post.tracking_api.ok", {
    organizationId,
    awbs: shipments.length,
    batches: fetched.batchesAttempted,
    httpStatus,
    articlesReceived: fetched.articles.length,
    articlesMatched,
    eventsInserted,
    durationMs: Date.now() - started,
  });

  return {
    availability:
      eventsInserted > 0 || matchingArticle?.tracking_details?.length || input.hasStoredEvents
        ? "TRACKING_AVAILABLE"
        : "TRACKING_NO_SCANS_YET",
    liveTracking: fetched.hardFailure ? "unavailable" : "ok",
    liveMessage: trackingRefreshMessage({ httpStatus, eventsInserted, skippedFetch: false }),
    eventsInserted,
    eventsDuplicate,
    articlesReceived: fetched.articles.length,
    articlesMatched,
    datesFetched: [],
    skippedFetch: false,
    matchingArticle,
    httpStatus,
    emptyNoContent: fetched.emptyNoContent,
    trackingSource: "tracking-api",
  };
}

export { availabilityForFailure };
