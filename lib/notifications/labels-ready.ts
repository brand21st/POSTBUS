import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";

export const LABELS_READY_NOTIFICATION = "labels.barcode_and_packing_ready";
export const LABELS_READY_TITLE = "Barcode and Packing slip Ready";

function firstId(data: unknown): string | null {
  if (Array.isArray(data)) {
    const id = (data[0] as { id?: string } | undefined)?.id;
    return id ? String(id) : null;
  }
  const id = (data as { id?: string } | null)?.id;
  return id ? String(id) : null;
}

export async function insertLabelsReadyNotification(
  supabase: SupabaseClient,
  input: { organizationId: string; shipmentId: string }
) {
  const { data: shipment } = await supabase
    .from("shipments")
    .select("barcode, tracking_number, order_id")
    .eq("id", input.shipmentId)
    .maybeSingle();
  let orderNumber = "";
  if (shipment?.order_id) {
    const { data: order } = await supabase
      .from("orders")
      .select("order_number")
      .eq("id", shipment.order_id)
      .maybeSingle();
    orderNumber = order?.order_number?.trim() || "";
  }
  const tracking = (shipment?.barcode || shipment?.tracking_number || "").trim();
  const body = [orderNumber, tracking].filter(Boolean).join(" · ") || "Download both files from Labels.";

  const { error } = await supabase.from("notifications").insert({
    organization_id: input.organizationId,
    type: LABELS_READY_NOTIFICATION,
    title: LABELS_READY_TITLE,
    body,
    entity_type: "shipment",
    entity_id: input.shipmentId,
  });
  if (error) {
    logError("LABELS_READY_NOTIFICATION_FAILED", {
      organizationId: input.organizationId,
      shipmentId: input.shipmentId,
      message: error.message,
    });
    throw Object.assign(new Error(error.message), { code: "NOTIFICATION_FAILED" });
  }
}

export async function notifyLabelsReadyIfComplete(
  supabase: SupabaseClient,
  input: { organizationId: string; shipmentId: string }
) {
  const { data, error } = await supabase
    .from("labels")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("shipment_id", input.shipmentId)
    .eq("kind", "INDIA_POST")
    .eq("status", "READY")
    .limit(1);
  if (error) {
    logError("LABELS_READY_BARCODE_LOOKUP_FAILED", {
      organizationId: input.organizationId,
      shipmentId: input.shipmentId,
      message: error.message,
    });
    return false;
  }
  if (!firstId(data)) return false;
  await insertLabelsReadyNotification(supabase, input);
  return true;
}
