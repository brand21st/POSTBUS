import type { SupabaseClient } from "@supabase/supabase-js";
import { logError, logInfo } from "@/lib/logger";
import { createBackgroundJob } from "@/modules/jobs/service";
import { enqueueShipmentBookingJob } from "@/modules/jobs/shipment-booking-job";
import { isIndiaPostAcceptedStatus } from "@/modules/india-post/booking-status";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import { isUnknownBookingError } from "@/modules/orders/error-facts";
import {
  addressLinesNeedAi,
  addressValidationFingerprint,
  isIndiaPostAddressError,
  refreshAddressPrebooking,
} from "@/modules/orders/prebooking-validation";
import { isAiAddressCheckEnabled } from "@/modules/automation/service";
import type { StoredShippingFields } from "@/modules/shopify/shipping-contact";

const ACTIVE_JOB = ["PENDING", "QUEUED", "RUNNING", "RETRYING"] as const;
const ADDRESS_JOB = "shopify-address-correction";

export type ShopifyAddressCorrectionPhase = "deterministic" | "ai";

export type ShopifyAddressBookingIntent = {
  enqueueBooking: boolean;
  enrollInQueue: boolean;
};

type ShipmentRow = {
  id?: string;
  status?: string | null;
  booked_at?: string | null;
  barcode?: string | null;
  last_error?: string | null;
  last_error_code?: string | null;
};

export type ShopifyAddressCorrectionResult = {
  outcome: "updated" | "unchanged" | "skipped" | "failed";
  skipReason?: string;
  changed: boolean;
  deferBooking: boolean;
  requeued: boolean;
  fingerprint: string | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function collapse(value: unknown) {
  return text(value).replace(/\s+/g, " ");
}

/** A newer Shopify update is already stored. An older payload must not replace it. */
export function shopifyAddressUpdateIsStale(storedAt?: string | null, incomingAt?: string | null) {
  const stored = Date.parse(text(storedAt));
  const incoming = Date.parse(text(incomingAt));
  return Number.isFinite(stored) && Number.isFinite(incoming) && incoming < stored;
}

export function shopifyBookingWaitsForAddressCorrection(deferBooking: boolean) {
  return deferBooking;
}

export function shouldRequeueCorrectedShopifyShipment(input: {
  changed: boolean;
  autoBooking: boolean;
  addressStatus?: string | null;
  shipment?: ShipmentRow | null;
}) {
  if (!input.changed || !input.autoBooking || !input.shipment?.id) return false;
  const shipment = input.shipment;
  if (text(shipment.booked_at) || text(shipment.barcode)) return false;
  if (isIndiaPostAcceptedStatus(shipment.status)) return false;
  if (text(shipment.status).toUpperCase() !== "FAILED") return false;
  if (isUnknownBookingError(shipment)) return false;
  const code = text(shipment.last_error_code).toUpperCase();
  const message = text(shipment.last_error);
  if (code.includes("PAYMENT") || /\bpayment\b/i.test(message)) return false;
  const addressStatus = text(input.addressStatus).toUpperCase();
  if (code && code !== "VALIDATION_ERROR") return false;
  if (code === "VALIDATION_ERROR") return isIndiaPostAddressError(message) || /city|pin/i.test(message);
  return addressStatus === "NEEDS_REVIEW" || addressStatus === "INVALID";
}

function addressChanged(before: StoredShippingFields, after: StoredShippingFields) {
  return (
    collapse(before.line1) !== collapse(after.line1) ||
    collapse(before.line2) !== collapse(after.line2) ||
    collapse(before.line3) !== collapse(after.line3) ||
    collapse(before.city) !== collapse(after.city) ||
    collapse(before.state) !== collapse(after.state)
  );
}

function logCorrection(
  outcome: string,
  fields: { organizationId: string; orderId: string; addressId?: string | null; [key: string]: unknown }
) {
  logInfo("shopify.address_correction", { outcome, ...fields });
}

async function openRouterEnabled() {
  try {
    const { getPlatformOpenRouterConfig } = await import("@/modules/openrouter/platform-config");
    return (await getPlatformOpenRouterConfig()).enabled;
  } catch {
    return false;
  }
}

async function pinLookup(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("india_post_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data || text((data as { status?: string }).status).toUpperCase() !== "CONNECTED") {
    return { search: undefined, result: "skipped" as const };
  }
  try {
    const provider = indiaPostFromRow(data as never);
    return {
      search: (pin: string) => provider.searchPostOffices(pin),
      result: "ready" as const,
    };
  } catch {
    return { search: undefined, result: "unavailable" as const };
  }
}

function asAddress(row: Record<string, unknown> | null, addressId: string): StoredShippingFields | null {
  if (!row) return null;
  return { ...(row as StoredShippingFields), id: addressId };
}

async function loadAddress(supabase: SupabaseClient, organizationId: string, addressId: string) {
  const { data } = await supabase
    .from("addresses")
    .select("*")
    .eq("id", addressId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return asAddress((data as Record<string, unknown> | null) ?? null, addressId);
}

async function loadShipments(supabase: SupabaseClient, organizationId: string, orderId: string) {
  const { data } = await supabase
    .from("shipments")
    .select("id, status, booked_at, barcode, last_error, last_error_code")
    .eq("organization_id", organizationId)
    .eq("order_id", orderId);
  return (Array.isArray(data) ? data : []) as ShipmentRow[];
}

function shipmentIsBooked(shipments: ShipmentRow[]) {
  return shipments.some((row) => Boolean(text(row.booked_at)) || isIndiaPostAcceptedStatus(row.status));
}

/**
 * Deterministic PIN alignment, then AI only when the lines still need it.
 * A failure here keeps the address already saved from Shopify.
 */
export async function correctShopifyShippingAddress(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    orderId: string;
    addressId: string;
    userId?: string;
    source?: string | null;
    sourceUpdatedAt?: string | null;
    phase?: ShopifyAddressCorrectionPhase;
    allowRequeue?: boolean;
    bookingIntent?: ShopifyAddressBookingIntent;
    /** Set by the background job after shipment creation. Import leaves this false. */
    resumeBooking?: boolean;
  }
): Promise<ShopifyAddressCorrectionResult> {
  const phase = input.phase ?? "deterministic";
  const empty: ShopifyAddressCorrectionResult = {
    outcome: "skipped",
    changed: false,
    deferBooking: false,
    requeued: false,
    fingerprint: null,
  };
  if (text(input.source || "SHOPIFY").toUpperCase() !== "SHOPIFY") {
    logCorrection("skipped", {
      organizationId: input.organizationId,
      orderId: input.orderId,
      addressId: input.addressId,
      reason: "source",
    });
    return { ...empty, skipReason: "source" };
  }
  try {
    const address = await loadAddress(supabase, input.organizationId, input.addressId);
    if (!address) {
      logCorrection("skipped", {
        organizationId: input.organizationId,
        orderId: input.orderId,
        addressId: input.addressId,
        reason: "missing",
      });
      return { ...empty, skipReason: "missing" };
    }
    if (address.address_manual_override === true) {
      logCorrection("skipped", {
        organizationId: input.organizationId,
        orderId: input.orderId,
        addressId: input.addressId,
        reason: "manual_override",
      });
      return { ...empty, skipReason: "manual_override" };
    }
    const storedUpdatedAt = text(
      (address.normalized_shipping as { sourceUpdatedAt?: string } | null)?.sourceUpdatedAt
    );
    if (shopifyAddressUpdateIsStale(storedUpdatedAt, input.sourceUpdatedAt)) {
      logCorrection("skipped", {
        organizationId: input.organizationId,
        orderId: input.orderId,
        addressId: input.addressId,
        reason: "stale",
      });
      return { ...empty, skipReason: "stale", fingerprint: addressValidationFingerprint(address) };
    }
    const shipments = await loadShipments(supabase, input.organizationId, input.orderId);
    if (shipmentIsBooked(shipments)) {
      logCorrection("skipped", {
        organizationId: input.organizationId,
        orderId: input.orderId,
        addressId: input.addressId,
        reason: "booked",
      });
      return { ...empty, skipReason: "booked" };
    }
    if (!/^[1-9][0-9]{5}$/.test(collapse(address.pincode))) {
      logCorrection("skipped", {
        organizationId: input.organizationId,
        orderId: input.orderId,
        addressId: input.addressId,
        reason: "incomplete",
      });
      return { ...empty, skipReason: "incomplete" };
    }

    logCorrection("attempted", {
      organizationId: input.organizationId,
      orderId: input.orderId,
      addressId: input.addressId,
      phase,
    });
    const lookup = await pinLookup(supabase, input.organizationId);
    const beforeCity = collapse(address.city);
    const beforeState = collapse(address.state);
    const aiAddressCheck = await isAiAddressCheckEnabled(supabase, input.organizationId);
    const refreshed = await refreshAddressPrebooking(supabase, {
      organizationId: input.organizationId,
      address,
      searchPostOffices: lookup.search,
      allowAi: phase === "ai" && aiAddressCheck,
      force: phase === "ai",
    });
    const pinResult =
      String(refreshed.address_validation_status ?? "").toUpperCase() === "VALIDATION_UNAVAILABLE"
        ? "unavailable"
        : lookup.result;
    logCorrection("pin", {
      organizationId: input.organizationId,
      orderId: input.orderId,
      addressId: input.addressId,
      pinResult,
    });
    const changed = addressChanged(address, refreshed);
    if (collapse(refreshed.city) !== beforeCity || collapse(refreshed.state) !== beforeState) {
      logCorrection("city_aligned", {
        organizationId: input.organizationId,
        orderId: input.orderId,
        addressId: input.addressId,
      });
    }
    if (phase === "ai") {
      logCorrection("ai", {
        organizationId: input.organizationId,
        orderId: input.orderId,
        addressId: input.addressId,
        used: text(refreshed.address_normalization_source).toLowerCase() === "ai",
      });
    }
    const fingerprint = addressValidationFingerprint(refreshed);
    logCorrection(changed ? "updated" : "unchanged", {
      organizationId: input.organizationId,
      orderId: input.orderId,
      addressId: input.addressId,
    });

    const intent = input.bookingIntent ?? { enqueueBooking: false, enrollInQueue: false };
    const needsAi =
      phase === "deterministic" && aiAddressCheck && addressLinesNeedAi(refreshed) && (await openRouterEnabled());
    if (needsAi) {
      return {
        outcome: changed ? "updated" : "unchanged",
        changed,
        deferBooking: true,
        requeued: false,
        fingerprint,
      };
    }

    let requeued = false;
    if (input.resumeBooking && (intent.enqueueBooking || intent.enrollInQueue)) {
      requeued = await resumeShopifyBooking(supabase, {
        organizationId: input.organizationId,
        orderId: input.orderId,
        userId: input.userId,
        intent,
        changed,
        addressStatus: refreshed.address_validation_status,
        shipments,
      });
    } else if (input.allowRequeue && (intent.enqueueBooking || intent.enrollInQueue)) {
      requeued = await requeueFailedAddressShipment(supabase, {
        organizationId: input.organizationId,
        orderId: input.orderId,
        userId: input.userId,
        changed,
        addressStatus: refreshed.address_validation_status,
        shipments,
        autoBooking: true,
      });
    }
    return {
      outcome: changed ? "updated" : "unchanged",
      changed,
      deferBooking: false,
      requeued,
      fingerprint,
    };
  } catch (error) {
    logError("shopify.address_correction", {
      outcome: "failed",
      organizationId: input.organizationId,
      orderId: input.orderId,
      addressId: input.addressId,
      message: error instanceof Error ? error.name : "unknown",
    });
    return { ...empty, outcome: "failed", skipReason: "failed" };
  }
}

async function requeueFailedAddressShipment(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    orderId: string;
    userId?: string;
    changed: boolean;
    addressStatus?: string | null;
    shipments: ShipmentRow[];
    autoBooking: boolean;
  }
) {
  const shipment = input.shipments.find((row) => text(row.status).toUpperCase() === "FAILED");
  if (
    !shouldRequeueCorrectedShopifyShipment({
      changed: input.changed,
      autoBooking: input.autoBooking,
      addressStatus: input.addressStatus,
      shipment,
    })
  ) {
    return false;
  }
  const shipmentId = text(shipment?.id);
  await supabase
    .from("shipments")
    .update({ status: "QUEUED", last_error: null, last_error_code: null })
    .eq("id", shipmentId)
    .eq("organization_id", input.organizationId)
    .is("booked_at", null)
    .is("barcode", null);
  await enqueueShipmentBookingJob(supabase, {
    organizationId: input.organizationId,
    jobType: "shipment-booking",
    entityType: "shipment",
    entityId: shipmentId,
    shipmentIds: [shipmentId],
    userId: input.userId,
  });
  logCorrection("requeued", {
    organizationId: input.organizationId,
    orderId: input.orderId,
    shipmentId,
  });
  return true;
}

async function enrollShopifyOrder(
  supabase: SupabaseClient,
  input: { organizationId: string; orderId: string; userId?: string }
) {
  const { enrollOrderAutomatically } = await import("@/modules/booking-queue/auto-enroll");
  const enrolled = await enrollOrderAutomatically(supabase, {
    organizationId: input.organizationId,
    orderId: input.orderId,
    source: "SHOPIFY",
    userId: input.userId,
  });
  if (enrolled.enrolled) {
    logCorrection("requeued", {
      organizationId: input.organizationId,
      orderId: input.orderId,
      via: "queue",
    });
  }
  return enrolled.enrolled;
}

async function resumeShopifyBooking(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    orderId: string;
    userId?: string;
    intent: ShopifyAddressBookingIntent;
    changed: boolean;
    addressStatus?: string | null;
    shipments: ShipmentRow[];
  }
) {
  if (shipmentIsBooked(input.shipments)) return false;
  const failed = input.shipments.find((row) => text(row.status).toUpperCase() === "FAILED");
  const autoBooking = input.intent.enqueueBooking || input.intent.enrollInQueue;
  if (failed) {
    if (
      !shouldRequeueCorrectedShopifyShipment({
        changed: input.changed,
        autoBooking,
        addressStatus: input.addressStatus,
        shipment: failed,
      })
    ) {
      return false;
    }
    if (input.intent.enrollInQueue) {
      return enrollShopifyOrder(supabase, input);
    }
    return requeueFailedAddressShipment(supabase, { ...input, autoBooking: true });
  }
  if (input.intent.enrollInQueue) {
    return enrollShopifyOrder(supabase, input);
  }
  if (!input.intent.enqueueBooking) return false;
  const open = input.shipments.find((row) => !text(row.booked_at) && !isIndiaPostAcceptedStatus(row.status));
  if (!open?.id) return false;
  if (isUnknownBookingError(open)) return false;
  await enqueueShipmentBookingJob(supabase, {
    organizationId: input.organizationId,
    jobType: "shipment-booking",
    entityType: "shipment",
    entityId: open.id,
    shipmentIds: [open.id],
    userId: input.userId,
  });
  logCorrection("requeued", {
    organizationId: input.organizationId,
    orderId: input.orderId,
    shipmentId: open.id,
  });
  return true;
}

export async function enqueueShopifyAddressCorrection(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    orderId: string;
    addressId: string;
    userId?: string;
    fingerprint: string | null;
    sourceUpdatedAt?: string | null;
    bookingIntent: ShopifyAddressBookingIntent;
    allowRequeue: boolean;
  }
) {
  const { data: existing } = await supabase
    .from("background_jobs")
    .select("id, status")
    .eq("organization_id", input.organizationId)
    .eq("job_type", ADDRESS_JOB)
    .eq("entity_type", "address")
    .eq("entity_id", input.addressId)
    .in("status", [...ACTIVE_JOB])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    logCorrection("skipped", {
      organizationId: input.organizationId,
      orderId: input.orderId,
      addressId: input.addressId,
      reason: "duplicate_job",
      jobId: existing.id,
    });
    return { jobId: existing.id as string, duplicate: true };
  }
  const job = await createBackgroundJob(supabase, {
    organizationId: input.organizationId,
    jobType: ADDRESS_JOB,
    entityType: "address",
    entityId: input.addressId,
    userId: input.userId,
    progress: {
      orderId: input.orderId,
      fingerprint: input.fingerprint,
      sourceUpdatedAt: input.sourceUpdatedAt ?? null,
      enqueueBooking: input.bookingIntent.enqueueBooking,
      enrollInQueue: input.bookingIntent.enrollInQueue,
      allowRequeue: input.allowRequeue,
    },
  });
  return { jobId: job.id as string, duplicate: false };
}

export async function runShopifyAddressCorrectionJob(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    addressId: string;
    userId?: string;
    progress?: Record<string, unknown> | null;
  }
) {
  const progress = input.progress ?? {};
  const orderId = text(progress.orderId);
  if (!orderId) return;
  await correctShopifyShippingAddress(supabase, {
    organizationId: input.organizationId,
    orderId,
    addressId: input.addressId,
    userId: input.userId,
    source: "SHOPIFY",
    phase: "ai",
    resumeBooking: true,
    bookingIntent: {
      enqueueBooking: progress.enqueueBooking === true,
      enrollInQueue: progress.enrollInQueue === true,
    },
  });
}
