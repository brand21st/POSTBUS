import type { SupabaseClient } from "@supabase/supabase-js";
import { findReadyIndiaPostLabel } from "@/modules/labels/ready";
import type { WatiNotifyEvent } from "@/modules/wati/notify";

const AFTER_LABEL_EVENTS = new Set<WatiNotifyEvent>([
  "booked",
  "in_transit",
  "delivered",
  "shipment_delayed",
]);

export async function canSendIndiaPostWhatsApp(
  supabase: SupabaseClient,
  organizationId: string,
  event: WatiNotifyEvent,
  shipmentId?: string | null
) {
  if (!AFTER_LABEL_EVENTS.has(event) || !shipmentId) return false;
  return Boolean(await findReadyIndiaPostLabel(supabase, organizationId, shipmentId));
}
