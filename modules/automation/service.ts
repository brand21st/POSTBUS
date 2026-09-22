import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import type { AutomationSettings } from "@/types/api";

type Column =
  | "auto_shopify_sync"
  | "auto_shipment_creation"
  | "auto_booking"
  | "auto_label_generation"
  | "auto_manifest"
  | "auto_tracking_sync"
  | "auto_shopify_fulfillment"
  | "auto_wati_order_confirmation"
  | "auto_wati_processing"
  | "auto_wati_booked"
  | "auto_wati_in_transit"
  | "auto_wati_delivered";

const CAMEL_TO_COLUMN: Record<string, Column> = {
  autoShopifySync: "auto_shopify_sync",
  auto_shopify_sync: "auto_shopify_sync",
  autoShipmentCreation: "auto_shipment_creation",
  auto_shipment_creation: "auto_shipment_creation",
  autoBooking: "auto_booking",
  auto_booking: "auto_booking",
  autoLabelGeneration: "auto_label_generation",
  auto_label_generation: "auto_label_generation",
  autoManifest: "auto_manifest",
  auto_manifest: "auto_manifest",
  autoTrackingSync: "auto_tracking_sync",
  auto_tracking_sync: "auto_tracking_sync",
  autoShopifyFulfillment: "auto_shopify_fulfillment",
  auto_shopify_fulfillment: "auto_shopify_fulfillment",
  autoWatiOrderConfirmation: "auto_wati_order_confirmation",
  auto_wati_order_confirmation: "auto_wati_order_confirmation",
  autoWatiProcessing: "auto_wati_processing",
  auto_wati_processing: "auto_wati_processing",
  autoWatiBooked: "auto_wati_booked",
  auto_wati_booked: "auto_wati_booked",
  autoWatiInTransit: "auto_wati_in_transit",
  auto_wati_in_transit: "auto_wati_in_transit",
  autoWatiDelivered: "auto_wati_delivered",
  auto_wati_delivered: "auto_wati_delivered",
};

export type AutomationRow = {
  organization_id: string;
  auto_shopify_sync: boolean;
  auto_shipment_creation: boolean;
  auto_booking: boolean;
  auto_label_generation: boolean;
  auto_manifest: boolean;
  auto_tracking_sync: boolean;
  auto_shopify_fulfillment: boolean;
  auto_wati_order_confirmation?: boolean;
  auto_wati_processing?: boolean;
  auto_wati_booked?: boolean;
  auto_wati_in_transit?: boolean;
  auto_wati_delivered?: boolean;
};

export const AUTOMATION_DEFAULTS: Omit<AutomationRow, "organization_id"> = {
  auto_shopify_sync: true,
  auto_shipment_creation: false,
  auto_booking: false,
  auto_label_generation: true,
  auto_manifest: true,
  auto_tracking_sync: true,
  auto_shopify_fulfillment: true,
  auto_wati_order_confirmation: true,
  auto_wati_processing: true,
  auto_wati_booked: true,
  auto_wati_in_transit: true,
  auto_wati_delivered: true,
};

export function mapAutomationSettings(row: AutomationRow): AutomationSettings {
  return {
    organizationId: row.organization_id,
    autoShopifySync: row.auto_shopify_sync,
    auto_shopify_sync: row.auto_shopify_sync,
    autoShipmentCreation: row.auto_shipment_creation,
    auto_shipment_creation: row.auto_shipment_creation,
    autoBooking: row.auto_booking,
    auto_booking: row.auto_booking,
    autoLabelGeneration: row.auto_label_generation,
    auto_label_generation: row.auto_label_generation,
    autoManifest: row.auto_manifest,
    auto_manifest: row.auto_manifest,
    autoTrackingSync: row.auto_tracking_sync,
    auto_tracking_sync: row.auto_tracking_sync,
    autoShopifyFulfillment: row.auto_shopify_fulfillment,
    auto_shopify_fulfillment: row.auto_shopify_fulfillment,
    autoWatiOrderConfirmation: row.auto_wati_order_confirmation ?? true,
    auto_wati_order_confirmation: row.auto_wati_order_confirmation ?? true,
    autoWatiProcessing: row.auto_wati_processing ?? true,
    auto_wati_processing: row.auto_wati_processing ?? true,
    autoWatiBooked: row.auto_wati_booked ?? true,
    auto_wati_booked: row.auto_wati_booked ?? true,
    autoWatiInTransit: row.auto_wati_in_transit ?? true,
    auto_wati_in_transit: row.auto_wati_in_transit ?? true,
    autoWatiDelivered: row.auto_wati_delivered ?? true,
    auto_wati_delivered: row.auto_wati_delivered ?? true,
  };
}

const WATI_EVENT_FLAG: Record<string, keyof AutomationSettings> = {
  order_confirmation: "autoWatiOrderConfirmation",
  processing: "autoWatiProcessing",
  booked: "autoWatiBooked",
  in_transit: "autoWatiInTransit",
  delivered: "autoWatiDelivered",
};

export async function isAutoWatiEventEnabled(
  supabase: SupabaseClient,
  organizationId: string,
  event: string
): Promise<boolean> {
  const key = WATI_EVENT_FLAG[event];
  if (!key) return true;
  try {
    const settings = await getAutomationSettings(supabase, organizationId);
    return Boolean(settings[key]);
  } catch {
    return true;
  }
}

export async function getAutomationSettings(
  supabase: SupabaseClient,
  organizationId: string
): Promise<AutomationSettings> {
  const { data, error } = await supabase
    .from("automation_settings")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }

  if (data) {
    return mapAutomationSettings(data as AutomationRow);
  }

  const { data: created, error: insertError } = await supabase
    .from("automation_settings")
    .insert({ organization_id: organizationId, ...AUTOMATION_DEFAULTS })
    .select("*")
    .single();

  if (insertError || !created) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      insertError?.message || "Could not create automation settings."
    );
  }

  return mapAutomationSettings(created as AutomationRow);
}

export async function isAutoShopifySyncEnabled(
  supabase: SupabaseClient,
  organizationId: string
): Promise<boolean> {
  try {
    const settings = await getAutomationSettings(supabase, organizationId);
    return Boolean(settings.autoShopifySync);
  } catch {
    return AUTOMATION_DEFAULTS.auto_shopify_sync;
  }
}

export async function updateAutomationSettings(
  supabase: SupabaseClient,
  ctx: TenantContext,
  patch: Record<string, unknown>
): Promise<AutomationSettings> {
  const updates: Partial<AutomationRow> = {};
  for (const [key, value] of Object.entries(patch)) {
    const column = CAMEL_TO_COLUMN[key];
    if (!column || typeof value !== "boolean") continue;
    updates[column] = value;
  }

  if (Object.keys(updates).length === 0) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "No automation flags were provided.");
  }

  const existing = await getAutomationSettings(supabase, ctx.organizationId);

  const { data, error } = await supabase
    .from("automation_settings")
    .update(updates)
    .eq("organization_id", ctx.organizationId)
    .select("*")
    .single();

  if (error || !data) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not save automation settings.");
  }

  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "automation.updated",
    entity_type: "automation_settings",
    entity_id: ctx.organizationId,
    before: existing,
    after: updates,
  });

  return mapAutomationSettings(data as AutomationRow);
}
