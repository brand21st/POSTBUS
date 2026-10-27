import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPostBusTrackingUrl } from "@/modules/tracking-pages/host";
import { createWooOrderNote, updateWooOrder, WooCommerceRequestError } from "@/modules/woocommerce/client";
import { credentialsFromConnection, loadWooConnection } from "@/modules/woocommerce/connect";
import { wooSettings } from "@/modules/woocommerce/orders";
import { POSTBUS_META_KEYS } from "@/modules/woocommerce/signature";

export function shouldAddTrackingNote(settings?: { addTrackingNote?: boolean } | null) {
  return settings?.addTrackingNote === true;
}

export function wooTrackingBody(input: { awb: string; note: boolean; status?: string | null }) {
  const body: Record<string, unknown> = {
    meta_data: [
      { key: POSTBUS_META_KEYS[0], value: input.awb },
      { key: POSTBUS_META_KEYS[1], value: buildPostBusTrackingUrl(input.awb) },
      { key: POSTBUS_META_KEYS[2], value: "India Post" },
    ],
  };
  if (input.status) body.status = input.status;
  return { body, note: input.note };
}

const STAGE_STATUS: Record<string, string> = {
  booked: "",
  dispatched: "in_transit",
  in_transit: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  returned: "returned",
};

export function wooStatusForStage(input: {
  stage: string;
  updateOrderStatus: boolean;
  statusMap?: Record<string, string> | null;
}) {
  if (!input.updateOrderStatus) return null;
  if (input.stage === "booked") return null;
  const key = STAGE_STATUS[input.stage] || input.stage;
  const chosen = (input.statusMap ?? {})[key] || (input.statusMap ?? {})[input.stage] || "";
  if (!chosen || chosen === "completed") {
    if (chosen === "completed" && input.statusMap?.[key] === "completed") return "completed";
    return chosen && chosen !== "completed" ? chosen : null;
  }
  return chosen;
}

export async function syncWooCommerceTracking(
  supabase: SupabaseClient,
  input: { organizationId: string; orderId: string; stage?: string | null }
) {
  const { data: order } = await supabase
    .from("orders")
    .select("id, source, source_order_id, metadata")
    .eq("id", input.orderId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (!order || order.source !== "WOOCOMMERCE" || !order.source_order_id) return { skipped: true };
  const connection = await loadWooConnection(supabase, input.organizationId);
  const creds = credentialsFromConnection(connection);
  if (!connection || connection.status !== "CONNECTED" || !creds) return { skipped: true };
  const { data: shipment } = await supabase
    .from("shipments")
    .select("tracking_number, barcode")
    .eq("organization_id", input.organizationId)
    .eq("order_id", input.orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const awb = String(shipment?.tracking_number || shipment?.barcode || "").trim();
  if (!awb) return { skipped: true };
  const settings = wooSettings(connection);
  const stage = input.stage || "booked";
  const status = wooStatusForStage({
    stage,
    updateOrderStatus: settings.updateOrderStatus === true,
    statusMap: settings.statusMap,
  });
  const payload = wooTrackingBody({ awb, note: false, status });
  try {
    await updateWooOrder(creds, String(order.source_order_id), payload.body);
    if (shouldAddTrackingNote(settings) && stage === "booked") {
      const url = buildPostBusTrackingUrl(awb);
      await createWooOrderNote(creds, String(order.source_order_id), `India Post tracking: ${awb}. Track: ${url}`);
    }
  } catch (error) {
    if (error instanceof WooCommerceRequestError && error.status === 429) throw error;
    if (error instanceof WooCommerceRequestError && error.status >= 500) throw error;
    await supabase
      .from("woocommerce_connections")
      .update({ last_error: error instanceof Error ? error.message : "Tracking sync failed." })
      .eq("id", connection.id);
    throw error;
  }
  const metadata = {
    ...((order.metadata as Record<string, unknown> | null) ?? {}),
    woocommerce: {
      ...((order.metadata as { woocommerce?: Record<string, unknown> } | null)?.woocommerce ?? {}),
      trackingNumber: awb,
      lastPushedStatus: status,
    },
  };
  await supabase.from("orders").update({ metadata }).eq("id", order.id);
  return { synced: true, awb };
}
