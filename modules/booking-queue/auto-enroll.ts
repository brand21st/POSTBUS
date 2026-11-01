import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { logError, logInfo } from "@/lib/logger";
import { autoEnrollmentAllowed, type QueueOrderSnapshot } from "@/modules/booking-queue/eligibility";
import { bookingQueueAutomationEnabledFor, bookingQueueEnabledFor } from "@/modules/booking-queue/flags";
import { enqueueOrders } from "@/modules/booking-queue/service";
import type { AutoEnrollSource } from "@/modules/booking-queue/settings";

export type AutoEnrollOutcome =
  | { enrolled: true; state: string }
  | { enrolled: false; reason: "QUEUE_OFF" | "SOURCE_OFF" | "NOT_ELIGIBLE" | "SKIPPED" | "ERROR"; detail?: string };

function systemCtx(organizationId: string, userId?: string | null): TenantContext {
  return {
    userId: userId ?? "",
    email: null,
    fullName: null,
    organizationId,
    organizationName: "",
    role: "OWNER",
    permissions: [],
  };
}

/**
 * Called after an integration import. Adds the order to the Bulk Booking queue when the workspace
 * enrolled that source and the order is settled (Prepaid or COD). Valid orders wait for approval
 * in manual mode and go straight to Ready to book in automatic mode. Never books, never throws:
 * an import must not fail because of the queue.
 */
export async function enrollOrderAutomatically(
  supabase: SupabaseClient,
  input: { organizationId: string; orderId: string; source: AutoEnrollSource; userId?: string | null }
): Promise<AutoEnrollOutcome> {
  if (!bookingQueueEnabledFor(input.organizationId)) return { enrolled: false, reason: "QUEUE_OFF" };
  try {
    const { data: settings } = await supabase
      .from("booking_automation_settings")
      .select("mode, enrollment_sources")
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    const sources = (settings?.enrollment_sources as string[] | null) ?? [];
    if (!sources.includes(input.source)) return { enrolled: false, reason: "SOURCE_OFF" };

    const { data: order } = await supabase
      .from("orders")
      .select("id, order_number, source, status, payment_status, shipments(id, status, booked_at, barcode, tracking_number)")
      .eq("organization_id", input.organizationId)
      .eq("id", input.orderId)
      .maybeSingle();
    if (!order || !autoEnrollmentAllowed(order as QueueOrderSnapshot, sources)) {
      return { enrolled: false, reason: "NOT_ELIGIBLE" };
    }

    const automatic = settings?.mode === "AUTOMATIC" && bookingQueueAutomationEnabledFor(input.organizationId);
    const result = await enqueueOrders(supabase, systemCtx(input.organizationId, input.userId), [input.orderId], {
      via: "AUTO",
      autoApprove: automatic,
    });
    const added = result.enqueued[0];
    if (!added) {
      return { enrolled: false, reason: "SKIPPED", detail: result.skipped[0]?.code };
    }
    logInfo("booking_queue.auto_enrolled", {
      organizationId: input.organizationId,
      orderId: input.orderId,
      source: input.source,
      state: added.state,
    });
    return { enrolled: true, state: added.state };
  } catch (error) {
    logError("booking_queue.auto_enroll_failed", {
      organizationId: input.organizationId,
      orderId: input.orderId,
      source: input.source,
      message: error instanceof Error ? error.message : "unknown",
    });
    return { enrolled: false, reason: "ERROR" };
  }
}
