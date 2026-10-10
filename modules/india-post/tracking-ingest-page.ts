import type { SupabaseClient } from "@supabase/supabase-js";
import { logInfo } from "@/lib/logger";
import {
  ingestBulkTrackingArticle,
  matchingBulkTrackingArticle,
  snapshotFromShipmentRow,
  type BulkTrackingArticle,
} from "@/modules/india-post/apply-tracking";
import { enqueueTrackingStageSideEffects } from "@/modules/india-post/tracking-effects";
import type { BulkTrackOutcome } from "@/modules/india-post/tracking-bulk";

export type TrackingPageShipment = {
  id: string;
  barcode?: string | null;
  status?: string | null;
  order_id?: string | null;
  operational_status?: string | null;
  last_event_at?: string | null;
  ndr_attempt_count?: number | null;
  rto_initiated_at?: string | null;
};

export function outcomeForBarcode(outcomes: BulkTrackOutcome[], barcode: string) {
  const wanted = barcode.trim();
  return outcomes.find((row) => row.barcode === wanted) ?? null;
}

/** last_tracked_at means last successful HTTP 200 lookup, including empty history. */
export async function stampSuccessfulTrack(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentId: string
) {
  const { error } = await supabase
    .from("shipments")
    .update({ last_tracked_at: new Date().toISOString() })
    .eq("id", shipmentId)
    .eq("organization_id", organizationId);
  if (error) {
    throw Object.assign(new Error(error.message), { code: "TEMPORARY_PROVIDER_FAILURE" });
  }
}

export async function applyBulkTrackingOutcomes(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    shipments: TrackingPageShipment[];
    outcomes: BulkTrackOutcome[];
    articles?: BulkTrackingArticle[];
    skipSideEffects?: boolean;
  }
) {
  let ingested = 0;
  let absent = 0;
  let rejected = 0;
  for (const shipment of input.shipments) {
    if (!shipment.barcode) continue;
    const barcode = String(shipment.barcode).trim();
    const matched = matchingBulkTrackingArticle(input.articles, barcode);
    const outcome =
      outcomeForBarcode(input.outcomes, barcode) ??
      (matched ? ({ barcode, status: "found" as const, article: matched } satisfies BulkTrackOutcome) : null);
    if (!outcome || outcome.status === "lookup_rejected") {
      rejected += 1;
      logInfo("india_post.tracking.lookup_rejected", {
        organizationId: input.organizationId,
        shipmentId: shipment.id,
        httpStatus: outcome?.status === "lookup_rejected" ? outcome.httpStatus : null,
      });
      continue;
    }
    if (outcome.status === "absent") {
      await stampSuccessfulTrack(supabase, input.organizationId, shipment.id);
      absent += 1;
      continue;
    }
    const ingestedArticle = await ingestBulkTrackingArticle(supabase, {
      organizationId: input.organizationId,
      shipment: snapshotFromShipmentRow(shipment, input.organizationId),
      article: outcome.article,
      source: "bulk",
    });
    ingested += 1;
    if (
      !input.skipSideEffects &&
      (ingestedArticle.whatsappEvents.length || ingestedArticle.orderStatus)
    ) {
      await enqueueTrackingStageSideEffects(supabase, {
        organizationId: input.organizationId,
        shipmentId: shipment.id,
        orderId: shipment.order_id,
        orderStatus: ingestedArticle.orderStatus,
        events: ingestedArticle.whatsappEvents,
      });
    }
  }
  return { ingested, absent, rejected };
}
