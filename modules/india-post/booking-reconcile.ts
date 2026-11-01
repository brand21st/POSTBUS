import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { shipmentBarcode, trackingHasArticle } from "@/modules/india-post/booking-idempotency";
import { evaluateOwnedBookingRetry } from "@/modules/india-post/booking-force-retry";
import { bookingQueueMessage } from "@/modules/india-post/booking-retry-eligibility";
import { persistBookedShipment } from "@/modules/india-post/booking-run";
import { indiaPostFromRow } from "@/modules/india-post/provider";

const UNCONFIRMED = bookingQueueMessage("BOOKING_OUTCOME_UNKNOWN");

/**
 * Tracking can confirm a booking that already exists.
 * An empty or missing tracking result is not permission to POST again.
 */
export async function reconcileUncertainBooking(
  supabase: SupabaseClient,
  ctx: TenantContext,
  shipmentId: string
) {
  const decision = await evaluateOwnedBookingRetry(supabase, ctx.organizationId, shipmentId);
  if (decision.action !== "BOOKING_OUTCOME_UNKNOWN" && decision.action !== "MANUAL_REVIEW_REQUIRED") {
    throw new AppError(ERROR_CODES.CONFLICT, decision.reason, { action: decision.action });
  }

  const { data: shipment, error } = await supabase
    .from("shipments")
    .select("id, barcode, tracking_number, booked_at, order_id")
    .eq("organization_id", ctx.organizationId)
    .eq("id", shipmentId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!shipment) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Shipment not found.");

  const barcode = shipmentBarcode(shipment.barcode || shipment.tracking_number);
  if (!barcode) {
    return { reconciled: false, shipmentId, message: UNCONFIRMED };
  }

  const { data: connection } = await supabase
    .from("india_post_connections")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (!connection || connection.status === "NOT_CONNECTED") {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "India Post is not connected.");
  }

  let tracked: unknown = null;
  try {
    const provider = indiaPostFromRow(connection);
    if (typeof provider.trackShipment !== "function") {
      return { reconciled: false, shipmentId, message: UNCONFIRMED };
    }
    tracked = await provider.trackShipment([barcode]);
  } catch {
    return { reconciled: false, shipmentId, message: UNCONFIRMED };
  }

  if (!trackingHasArticle(tracked, barcode)) {
    await supabase.from("audit_logs").insert({
      organization_id: ctx.organizationId,
      actor_id: ctx.userId,
      action: "shipment.reconcile_unconfirmed",
      entity_type: "shipment",
      entity_id: shipmentId,
      after: { barcodePresent: true },
    });
    return { reconciled: false, shipmentId, message: UNCONFIRMED };
  }

  const saved = await persistBookedShipment(supabase, {
    organizationId: ctx.organizationId,
    shipmentId,
    orderId: shipment.order_id,
    barcode,
    articleId: barcode,
    bookedAt: shipment.booked_at,
  });
  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "shipment.reconcile_confirmed",
    entity_type: "shipment",
    entity_id: shipmentId,
    after: { saved },
  });
  return {
    reconciled: saved,
    shipmentId,
    message: saved ? "India Post tracking confirms this shipment is booked." : UNCONFIRMED,
  };
}
