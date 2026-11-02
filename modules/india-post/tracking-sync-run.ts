import type { SupabaseClient } from "@supabase/supabase-js";
import { logInfo } from "@/lib/logger";
import {
  ingestBulkTrackingArticle,
  matchingBulkTrackingArticle,
  snapshotFromShipmentRow,
  TRACKING_POLL_STATUSES,
  type BulkTrackingArticle,
} from "@/modules/india-post/apply-tracking";
import { enqueueTrackingStageSideEffects } from "@/modules/india-post/tracking-effects";
import { applyBulkTrackingOutcomes, type TrackingPageShipment } from "@/modules/india-post/tracking-ingest-page";
import { trackingIsolateMaxRequests, type TrackShipmentResult } from "@/modules/india-post/tracking-bulk";
import {
  filterTrackingP0CanaryShipments,
  isTrackingP0CanaryOrganization,
  trackingP0CanaryActive,
  trackingP0CanaryAllowlist,
  trackingP0CanarySideEffectsEnabled,
} from "@/modules/india-post/tracking-p0-canary";
import { trackingSyncCutoffIso, trackingSyncPageSize } from "@/modules/india-post/tracking-sync";

type TrackingProvider = {
  trackShipment: (
    barcodes: string[],
    options?: { isolateFailures?: boolean; isolateBudget?: { remaining: number } }
  ) => Promise<TrackShipmentResult | { data?: BulkTrackingArticle[] }>;
};

async function loadDueShipments(
  supabase: SupabaseClient,
  organizationId: string,
  pageSize: number,
  cutoff: string
) {
  const { data: shipments } = await supabase
    .from("shipments")
    .select("id, barcode, status, order_id, operational_status, last_event_at, ndr_attempt_count, rto_initiated_at")
    .eq("organization_id", organizationId)
    .not("barcode", "is", null)
    .in("status", [...TRACKING_POLL_STATUSES])
    .or("operational_status.is.null,operational_status.neq.RTO_DELIVERED")
    .or(`last_tracked_at.is.null,last_tracked_at.lt.${cutoff}`)
    .order("last_tracked_at", { ascending: true, nullsFirst: true })
    .limit(pageSize);
  return (shipments ?? []) as TrackingPageShipment[];
}

async function applyLegacyTrackingPage(
  supabase: SupabaseClient,
  organizationId: string,
  rows: TrackingPageShipment[],
  result: { data?: BulkTrackingArticle[] }
) {
  let stamped = 0;
  let ingested = 0;
  for (const shipment of rows) {
    if (!shipment.barcode) continue;
    const article = matchingBulkTrackingArticle(result.data, shipment.barcode);
    if (!article) {
      await supabase
        .from("shipments")
        .update({ last_tracked_at: new Date().toISOString() })
        .eq("id", shipment.id)
        .eq("organization_id", organizationId);
      stamped += 1;
      continue;
    }
    const ingestedArticle = await ingestBulkTrackingArticle(supabase, {
      organizationId,
      shipment: snapshotFromShipmentRow(shipment, organizationId),
      article,
      source: "bulk",
    });
    ingested += 1;
    if (ingestedArticle.whatsappEvents.length || ingestedArticle.orderStatus) {
      await enqueueTrackingStageSideEffects(supabase, {
        organizationId,
        shipmentId: shipment.id,
        orderId: shipment.order_id,
        orderStatus: ingestedArticle.orderStatus,
        events: ingestedArticle.whatsappEvents,
      });
    }
  }
  return { stamped, ingested };
}

export async function runOrganizationTrackingSync(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    provider: TrackingProvider;
  }
) {
  const pageSize = trackingSyncPageSize();
  const cutoff = trackingSyncCutoffIso();
  const canary = trackingP0CanaryActive() && isTrackingP0CanaryOrganization(input.organizationId);
  if (trackingP0CanaryActive() && canary && !trackingP0CanaryAllowlist().length) {
    logInfo("india_post.tracking.canary_awaiting_allowlist", { organizationId: input.organizationId });
    return {
      mode: "canary-idle" as const,
      pages: 0,
      barcodesSynced: 0,
      ingested: 0,
      absent: 0,
      rejected: 0,
      stamped: 0,
      lastPageFull: false,
      maxPages: 1,
    };
  }

  const isolateBudget = { remaining: trackingIsolateMaxRequests() };
  const maxPages = canary ? 1 : 4;
  let page = 0;
  let lastPageFull = false;
  let barcodesSynced = 0;
  let ingested = 0;
  let absent = 0;
  let rejected = 0;
  let stamped = 0;

  while (page < maxPages) {
    let rows = await loadDueShipments(supabase, input.organizationId, pageSize, cutoff);
    if (canary) {
      rows = filterTrackingP0CanaryShipments(input.organizationId, rows);
    }
    lastPageFull = !canary && rows.length === pageSize;
    const barcodes = rows.map((item) => String(item.barcode ?? "").trim()).filter(Boolean);
    if (!barcodes.length) break;
    barcodesSynced += barcodes.length;

    if (canary) {
      const result = (await input.provider.trackShipment(barcodes, {
        isolateFailures: true,
        isolateBudget,
      })) as TrackShipmentResult;
      const applied = await applyBulkTrackingOutcomes(supabase, {
        organizationId: input.organizationId,
        shipments: rows,
        outcomes: result.outcomes ?? [],
        articles: result.data,
        skipSideEffects: !trackingP0CanarySideEffectsEnabled(),
      });
      ingested += applied.ingested;
      absent += applied.absent;
      rejected += applied.rejected;
      if (applied.rejected > 0 && applied.ingested === 0 && applied.absent === 0) {
        throw Object.assign(new Error("India Post rejected tracking lookup for this workspace batch."), {
          code: "TRACKING_LOOKUP_REJECTED",
          status: 400,
        });
      }
    } else {
      const result = await input.provider.trackShipment(barcodes, { isolateFailures: false });
      const applied = await applyLegacyTrackingPage(supabase, input.organizationId, rows, result);
      ingested += applied.ingested;
      stamped += applied.stamped;
    }
    page += 1;
    if (canary || rows.length < pageSize) break;
  }

  return {
    mode: canary ? ("canary" as const) : ("legacy" as const),
    pages: page,
    barcodesSynced,
    ingested,
    absent,
    rejected,
    stamped,
    lastPageFull,
    maxPages,
  };
}
