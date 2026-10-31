import type { SupabaseClient } from "@supabase/supabase-js";
import { allocateNextBarcode } from "@/modules/india-post/allocate-barcode";
import { barcodeForSelectedService } from "@/modules/india-post/barcode";
import { mapShipmentToArticle } from "@/modules/india-post/article-mapper";
import { assertValidatedArticle } from "@/modules/india-post/article-validator";
import { applyWorkspaceParcelDefaults, parcelDefaultsFromConnection } from "@/modules/india-post/parcel-defaults";
import { indiaPostBookingTransport } from "@/modules/india-post/booking-batch";
import { serializeIndiaPostBookingArticle } from "@/modules/india-post/booking-payload";
import { splitIndiaPostBookingResult, type IndiaPostBookingResponse } from "@/modules/india-post/booking-apply";
import { indiaPostBookingServiceCode, indiaPostMobile } from "@/modules/india-post/endpoints";
import {
  shippingAddressBookingBlock,
  type StoredShippingFields,
} from "@/modules/shopify/shipping-contact";
import { ensureLegacyAddressValidation } from "@/modules/orders/historical-classify";
import {
  BOOKING_CLAIMABLE_STATUSES,
  barcodeLogRef,
  isAuthoritativeIndiaPostBooking,
  isIndiaPostBookingUnknown,
  isIndiaPostDuplicateArticleMessage,
  shipmentBarcode,
  trackingHasArticle,
} from "@/modules/india-post/booking-idempotency";
import { cachedOfficeLookup, resolveIndiaPostOrigin } from "@/modules/india-post/origin";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import { persistIndiaPostTokens } from "@/modules/india-post/session";
import { organizationLabelSender } from "@/modules/organizations/label-sender";
import { DEFAULT_INDIA_POST_SERVICE } from "@/types/domain";
import { commercePendingBookingBlocked } from "@/lib/dashboard/records";
import { withIndiaPostBookingLock } from "@/modules/india-post/booking-lock";
import { classifyProviderError } from "@/lib/jobs/retry";
import { tagPrePostBookingError } from "@/modules/india-post/booking-failure-state";
import { existingBarcodeMayBeSubmitted } from "@/modules/india-post/booking-retry-eligibility";
import { trustedFirstBarcodeProof } from "@/modules/india-post/booking-provenance";
import { metadataWithCeptSubmitIntent, readCeptSubmitIntentAt } from "@/modules/india-post/booking-intent";
import { logInfo, logError } from "@/lib/logger";

type Admin = SupabaseClient;

function isRetryableCeptUncertainty(error: unknown) {
  const anyError = error as { name?: string; code?: string; message?: string };
  return (
    anyError?.name === "AbortError" ||
    anyError?.name === "TimeoutError" ||
    anyError?.code === "ABORT_ERR" ||
    anyError?.code === "ETIMEDOUT" ||
    /timeout|network|econn/i.test(String(anyError?.message ?? ""))
  );
}

export async function markShipmentBookingFailed(
  supabase: Admin,
  shipmentId: string,
  message: string,
  code = "VALIDATION_ERROR",
  organizationId?: string
) {
  let query = supabase
    .from("shipments")
    .update({ status: "FAILED", last_error: message, last_error_code: code })
    .eq("id", shipmentId)
    .is("booked_at", null)
    .in("status", [...BOOKING_CLAIMABLE_STATUSES, "BOOKING"]);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data } = await query.select("id, organization_id, order_id, last_error_code").maybeSingle();
  if (data?.organization_id) {
    try {
      const { publishBookingFailed } = await import("@/modules/webhooks/publish");
      await publishBookingFailed(supabase, {
        organizationId: data.organization_id,
        shipmentId: data.id,
        orderId: data.order_id,
        errorCode: data.last_error_code ?? code,
      });
    } catch {
      // Webhook fan-out must not break booking failure persistence.
    }
  }
}

export async function persistBookedShipment(
  supabase: Admin,
  input: {
    organizationId: string;
    shipmentId: string;
    orderId?: string | null;
    barcode: string;
    articleId: string;
    tariff?: number | null;
    batchId?: string | null;
    correlationId?: string | null;
    bookedAt?: string | null;
    persistDefaults?: { dims: boolean; weight: boolean };
    payload?: Record<string, string | number>;
  }
) {
  const bookedAt = input.bookedAt || new Date().toISOString();
  const { data, error } = await supabase
    .from("shipments")
    .update({
      status: "BOOKED",
      tracking_number: input.articleId,
      barcode: input.articleId || input.barcode,
      tariff_amount: input.tariff ?? null,
      provider_ref: input.batchId ?? null,
      correlation_id: input.correlationId ?? null,
      booked_at: bookedAt,
      last_error: null,
      last_error_code: null,
      ...(input.persistDefaults?.dims && input.payload
        ? {
            length_cm: input.payload.length,
            width_cm: input.payload.breadth_diameter,
            height_cm: input.payload.height,
          }
        : {}),
      ...(input.persistDefaults?.weight && input.payload
        ? { weight_grams: input.payload.physical_weight }
        : {}),
      // Groups the shipment onto the right per-office pickup manifest.
      ...(input.payload?.pickup_dropoff_office_id
        ? { booking_office_id: String(input.payload.pickup_dropoff_office_id) }
        : {}),
    })
    .eq("id", input.shipmentId)
    .eq("organization_id", input.organizationId)
    .in("status", ["BOOKING", "RECOVERY_REQUIRED", "FAILED", "QUEUED", "VALIDATING", "DRAFT", "BOOKED"])
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    logInfo("booking.persistence_conflict", {
      organizationId: input.organizationId,
      shipmentId: input.shipmentId,
      barcodeRef: barcodeLogRef(input.barcode),
    });
    return false;
  }
  if (input.orderId) {
    await supabase.from("orders").update({ status: "BOOKED" }).eq("id", input.orderId);
    try {
      // Stock commits only after a successful BOOKED persist. CANCEL / RTO / RETURN
      // must not auto-restock until a dedicated reversal is added (ORDER_RELEASE / RTO_RETURN).
      await supabase.rpc("commit_order_inventory", { p_order_id: input.orderId });
    } catch (error) {
      logInfo("booking.inventory_commit_skipped", {
        organizationId: input.organizationId,
        orderId: input.orderId,
        message: error instanceof Error ? error.message : "commit_order_inventory failed",
      });
    }
  }
  logInfo("booking.persistence_success", {
    organizationId: input.organizationId,
    shipmentId: input.shipmentId,
    barcodeRef: barcodeLogRef(input.barcode),
  });
  try {
    const { publishShipmentBooked } = await import("@/modules/webhooks/publish");
    await publishShipmentBooked(supabase, {
      organizationId: input.organizationId,
      shipmentId: input.shipmentId,
      orderId: input.orderId,
      awb: input.articleId || input.barcode,
    });
  } catch {
    // Webhook fan-out must not break a successful BOOKED persist.
  }
  return true;
}

async function reloadShipmentForSubmit(supabase: Admin, shipmentId: string, organizationId: string) {
  try {
    const byId = supabase
      .from("shipments")
      .select("id, organization_id, barcode, booked_at, metadata, status, last_error_code, tracking_number, provider_ref, created_at")
      .eq("id", shipmentId);
    if (typeof byId.maybeSingle !== "function") return null;
    const { data, error } = await byId.maybeSingle();
    if (error || !data) return null;
    if (data.organization_id && String(data.organization_id) !== organizationId) return data;
    return data;
  } catch {
    return null;
  }
}

async function claimShipmentForBooking(
  supabase: Admin,
  input: { organizationId: string; shipmentId: string; barcode?: string | null }
) {
  const barcode = shipmentBarcode(input.barcode) || null;
  const patch: Record<string, unknown> = { status: "BOOKING" };
  if (barcode) patch.barcode = barcode;
  const { data, error } = await supabase
    .from("shipments")
    .update(patch)
    .eq("id", input.shipmentId)
    .eq("organization_id", input.organizationId)
    .in("status", [...BOOKING_CLAIMABLE_STATUSES])
    .is("booked_at", null)
    .select("id, barcode, status, booked_at")
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; barcode: string | null; status: string; booked_at: string | null } | null;
}

export function assertShipmentsClassified(input: {
  requestedIds: string[];
  bookedIds: string[];
  failedIds: string[];
  preparedIds: string[];
}) {
  const done = new Set([...input.bookedIds, ...input.failedIds]);
  const unresolved = input.requestedIds.filter((id) => !done.has(id));
  if (!unresolved.length) return;
  const prepared = new Set(input.preparedIds);
  const posted = unresolved.filter((id) => prepared.has(id));
  if (posted.length) {
    throw Object.assign(new Error("India Post booking result is unknown. The article was not submitted again."), {
      code: "CEPT_UNKNOWN",
      shipmentIds: posted,
    });
  }
  throw Object.assign(new Error("Shipment was not classified for booking."), {
    code: "PRE_POST_TRANSIENT",
    bookingPhase: "PRE_POST",
    shipmentIds: unresolved,
  });
}

export async function runIndiaPostBooking(
  supabase: Admin,
  input: {
    organizationId: string;
    shipmentIds: string[];
    jobId?: string;
  }
) {
  const { data: connection } = await supabase
    .from("india_post_connections")
    .select("*")
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (!connection || connection.status === "NOT_CONNECTED") {
    throw Object.assign(new Error("India Post is not connected."), { code: "PERMANENT_AUTH_ERROR" });
  }

  const { data: shipments } = await supabase
    .from("shipments")
    .select("*, orders(*), customers(*), addresses:shipping_address_id(*)")
    .eq("organization_id", input.organizationId)
    .in("id", input.shipmentIds);
  if (!shipments?.length) {
    throw Object.assign(new Error("Shipment not found."), { code: "VALIDATION_ERROR" });
  }

  const alreadyBooked = shipments.filter((row) => isAuthoritativeIndiaPostBooking(row));
  const awaitsProof = (row: (typeof shipments)[number]) =>
    !isAuthoritativeIndiaPostBooking(row) &&
    (isIndiaPostBookingUnknown(row) || Boolean(readCeptSubmitIntentAt(row.metadata)));
  const unknown = shipments.filter(awaitsProof);
  const pending = shipments.filter((row) => !isAuthoritativeIndiaPostBooking(row) && !awaitsProof(row));
  const bookedIds: string[] = alreadyBooked.map((row) => row.id);
  const failedIds: string[] = [];

  for (const row of alreadyBooked) {
    logInfo("booking.already_booked", {
      organizationId: input.organizationId,
      shipmentId: row.id,
      jobId: input.jobId,
      barcodeRef: barcodeLogRef(row.barcode || row.tracking_number),
      status: row.status,
    });
    if (String(row.status).toUpperCase() === "FAILED" && row.booked_at) {
      await persistBookedShipment(supabase, {
        organizationId: input.organizationId,
        shipmentId: row.id,
        orderId: row.order_id,
        barcode: shipmentBarcode(row.barcode || row.tracking_number),
        articleId: shipmentBarcode(row.tracking_number || row.barcode),
        bookedAt: row.booked_at,
      });
    }
  }

  if (!pending.length && !unknown.length) {
    return { booked: bookedIds.length, failed: 0, bookedIds, failedIds, prepared: [], result: null };
  }

  const { data: pickup } = await supabase
    .from("pickup_locations")
    .select("*")
    .eq("organization_id", input.organizationId)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: org } = await supabase
    .from("organizations")
    .select("name, phone, line1, line2, city, state, pincode")
    .eq("id", input.organizationId)
    .maybeSingle();
  const { data: shop } = await supabase
    .from("shopify_stores")
    .select("shop_name")
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  const senderIdentity = organizationLabelSender(org, pickup, shop?.shop_name);

  const { data: contracts } = await supabase
    .from("india_post_contracts")
    .select("service_code, contract_id")
    .eq("organization_id", input.organizationId)
    .eq("is_active", true);
  const contractByService = new Map(
    (contracts ?? []).map((row) => [String(row.service_code), String(row.contract_id)])
  );

  const provider = indiaPostFromRow(connection);
  const offices = cachedOfficeLookup(provider);

  for (const row of unknown) {
    const barcode = shipmentBarcode(row.barcode);
    logInfo("booking.cept_unknown", {
      organizationId: input.organizationId,
      shipmentId: row.id,
      jobId: input.jobId,
      barcodeRef: barcodeLogRef(barcode),
      lastErrorCode: row.last_error_code ?? null,
    });
    let recovered = false;
    let tracked: unknown = null;
    let trackingOk = false;
    if (typeof provider.trackShipment === "function" && barcode) {
      try {
        tracked = await provider.trackShipment([barcode]);
        trackingOk = true;
        if (trackingHasArticle(tracked, barcode)) {
          recovered = await persistBookedShipment(supabase, {
            organizationId: input.organizationId,
            shipmentId: row.id,
            orderId: row.order_id,
            barcode,
            articleId: barcode,
            bookedAt: row.booked_at,
          });
        }
      } catch {
        recovered = false;
        trackingOk = false;
      }
    }
    if (recovered) {
      bookedIds.push(row.id);
      continue;
    }
    const trackingResult = !trackingOk
      ? "UNAVAILABLE"
      : trackingHasArticle(tracked, barcode)
        ? "FOUND"
        : "INCONCLUSIVE";
    const unknownCode =
      String(row.last_error_code ?? "").toUpperCase() === "ETIMEDOUT" ? "ETIMEDOUT" : "CEPT_UNKNOWN";
    logInfo("booking.recovery_required", {
      INDIA_POST_ENV: connection.environment === "PRODUCTION" ? "PRODUCTION" : "UAT",
      organizationId: input.organizationId,
      shipmentId: row.id,
      jobId: input.jobId,
      connectionId: String(connection.id ?? ""),
      reason: unknownCode,
      provider_status: unknownCode === "CEPT_UNKNOWN" ? 409 : undefined,
      tracking_result: trackingResult,
    });
    await supabase
      .from("shipments")
      .update({
        status: "RECOVERY_REQUIRED",
        last_error_code: unknownCode,
      })
      .eq("id", row.id)
      .eq("organization_id", input.organizationId)
      .in("status", ["BOOKING", "RECOVERY_REQUIRED", "QUEUED", "FAILED"])
      .is("booked_at", null);
    throw Object.assign(new Error("India Post booking result is unknown. The article was not submitted again."), {
      code: unknownCode,
    });
  }

  if (!pending.length) {
    return { booked: bookedIds.length, failed: failedIds.length, bookedIds, failedIds, prepared: [], result: null };
  }

  let session: Awaited<ReturnType<typeof provider.ensureSession>>;
  try {
    session = await provider.ensureSession();
  } catch (error) {
    throw tagPrePostBookingError(error);
  }
  if (!session.reused && session.tokens) {
    await persistIndiaPostTokens(supabase, connection, session.tokens);
  }

  const prepared: Array<{
    shipment: (typeof pending)[number];
    barcode: string;
    payload: Record<string, string | number>;
    persistDefaults: { dims: boolean; weight: boolean };
    allocatedThisRun: boolean;
    provenFirstBarcode: boolean;
  }> = [];
  const reviewIds: string[] = [];

  for (const shipment of pending) {
    const requestedService = (shipment.service_code as string) || DEFAULT_INDIA_POST_SERVICE;
    const loadedBarcode = shipmentBarcode(shipment.barcode);
    const provenFirstBarcode = Boolean(loadedBarcode) && trustedFirstBarcodeProof(shipment);
    if (loadedBarcode && !existingBarcodeMayBeSubmitted(shipment) && !provenFirstBarcode) {
      await supabase
        .from("shipments")
        .update({
          status: "RECOVERY_REQUIRED",
          last_error: "Booking outcome could not be confirmed. Please contact support before retrying.",
          last_error_code: "BOOKING_REVIEW_REQUIRED",
        })
        .eq("id", shipment.id)
        .eq("organization_id", input.organizationId)
        .is("booked_at", null);
      reviewIds.push(shipment.id);
      logInfo("booking.historical_blocked", {
        organizationId: input.organizationId,
        shipmentId: shipment.id,
        jobId: input.jobId,
        barcodeRef: barcodeLogRef(loadedBarcode),
      });
      continue;
    }
    let barcode = barcodeForSelectedService(loadedBarcode, requestedService);
    let allocatedThisRun = false;
    const serviceCode = indiaPostBookingServiceCode(requestedService, barcode);
    const contractId = contractByService.get(serviceCode) || connection.contract_id;
    if (!contractId) {
      const message = `No India Post contract is set for ${serviceCode}. Add it on the India Post integration page.`;
      await markShipmentBookingFailed(supabase, shipment.id, message, "INVALID_CONTRACT", input.organizationId);
      throw Object.assign(new Error(message), { code: "INVALID_CONTRACT" });
    }
    const linkedOrder = shipment.orders as {
      source?: string | null;
      payment_status?: string | null;
      paymentStatus?: string | null;
    } | null;
    if (commercePendingBookingBlocked(linkedOrder ?? {})) {
      const source = (linkedOrder?.source ?? "").toUpperCase() === "WOOCOMMERCE" ? "WooCommerce" : "Shopify";
      const message = `${source} payment is pending. Confirm Prepaid or COD before India Post booking.`;
      await markShipmentBookingFailed(supabase, shipment.id, message, "VALIDATION_ERROR", input.organizationId);
      failedIds.push(shipment.id);
      continue;
    }

    const rawAddress = shipment.addresses as StoredShippingFields | null;
    const address = rawAddress?.id
      ? await ensureLegacyAddressValidation(supabase, {
          organizationId: input.organizationId,
          address: rawAddress,
        })
      : rawAddress;
    const addressBlock = shippingAddressBookingBlock(address);
    if (addressBlock) {
      await markShipmentBookingFailed(supabase, shipment.id, addressBlock, "VALIDATION_ERROR", input.organizationId);
      failedIds.push(shipment.id);
      continue;
    }

    const destPincode = address?.pincode ?? "";
    let origin;
    try {
      origin = await resolveIndiaPostOrigin(
        offices,
        connection,
        {
          ...pickup,
          pincode: senderIdentity.pincode || pickup?.pincode,
          city: senderIdentity.city || pickup?.city,
          state: senderIdentity.state || pickup?.state,
        },
        destPincode
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "India Post origin could not be resolved.";
      await markShipmentBookingFailed(supabase, shipment.id, message, "VALIDATION_ERROR", input.organizationId);
      failedIds.push(shipment.id);
      continue;
    }

    if (!barcode) {
      barcode = await allocateNextBarcode(supabase, {
        organizationId: input.organizationId,
        serviceCode,
        environment: connection.environment,
      });
      allocatedThisRun = true;
    }

    const claimed = await claimShipmentForBooking(supabase, {
      organizationId: input.organizationId,
      shipmentId: shipment.id,
      barcode,
    });
    logInfo("booking.claimed", {
      organizationId: input.organizationId,
      shipmentId: shipment.id,
      jobId: input.jobId,
      barcodeRef: barcodeLogRef(barcode),
      claimed: Boolean(claimed),
    });
    if (!claimed) {
      logInfo("booking.guard", {
        organizationId: input.organizationId,
        shipmentId: shipment.id,
        jobId: input.jobId,
        barcodeRef: barcodeLogRef(barcode),
      });
      continue;
    }
    barcode = shipmentBarcode(claimed.barcode) || barcode;

    try {
      const senderMobile = indiaPostMobile(senderIdentity.phone);
      const receiverMobile = indiaPostMobile(address?.phone);
      const missingDims = !(
        Number(shipment.length_cm) > 0 &&
        Number(shipment.width_cm) > 0 &&
        Number(shipment.height_cm) > 0
      );
      const missingWeight = !(Number(shipment.weight_grams) > 0);
      const draft = applyWorkspaceParcelDefaults(
        mapShipmentToArticle({
        orderId: shipment.order_id,
        orderNumber: (shipment.orders as { order_number?: string } | null)?.order_number,
        shipmentId: shipment.id,
        serviceCode,
        customerId: String(connection.bulk_customer_id ?? ""),
        contractId: String(contractId),
        barcode,
        officeId: origin.officeId,
        originPin: origin.pincode,
        weightGrams: Number(shipment.weight_grams) || 0,
        lengthCm: Number(shipment.length_cm) || 0,
        widthCm: Number(shipment.width_cm) || 0,
        heightCm: Number(shipment.height_cm) || 0,
        senderName: senderIdentity.name,
        senderCompany: org?.name || pickup?.name || senderIdentity.name,
        senderLine1: senderIdentity.line1,
        senderLine2: senderIdentity.line2,
        senderCity: senderIdentity.city || origin.city,
        senderState: senderIdentity.state || origin.state,
        senderPin: origin.pincode,
        senderMobile: senderMobile || "",
        receiverName: address?.name ?? "",
        receiverCompany: address?.company_name || address?.name || "",
        receiverLine1: address?.line1 ?? "",
        receiverLine2: address?.line2 ?? "",
        receiverLine3: address?.line3 ?? "",
        receiverCity: address?.city ?? "",
        receiverState: address?.state ?? "",
        receiverPin: destPincode,
        receiverMobile: receiverMobile || "",
        paymentMode: shipment.payment_mode,
        codAmount: Number(shipment.cod_amount) || 0,
        strictWeight: true,
        strictDimensions: true,
      }),
        parcelDefaultsFromConnection(connection)
      );
      const validated = assertValidatedArticle(draft);
      prepared.push({
        shipment,
        barcode,
        payload: serializeIndiaPostBookingArticle(validated),
        persistDefaults: { dims: missingDims, weight: missingWeight },
        allocatedThisRun,
        provenFirstBarcode,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Validation failed.";
      const code = String((error as { code?: string })?.code || "VALIDATION_ERROR");
      await markShipmentBookingFailed(supabase, shipment.id, message, code, input.organizationId);
      if (pending.length === 1) throw tagPrePostBookingError(Object.assign(new Error(message), { code }));
    }
  }

  if (!prepared.length) {
    if (reviewIds.length) {
      throw Object.assign(new Error("Booking needs review before it can be submitted. The article was not submitted again."), {
        code: "BOOKING_REVIEW_REQUIRED",
        shipmentIds: reviewIds,
      });
    }
    if (bookedIds.length || failedIds.length) {
      assertShipmentsClassified({
        requestedIds: input.shipmentIds,
        bookedIds,
        failedIds,
        preparedIds: prepared.map((item) => item.shipment.id),
      });
      return { booked: bookedIds.length, failed: failedIds.length, bookedIds, failedIds, prepared, result: null };
    }
    throw Object.assign(new Error("No articles passed validation."), { code: "VALIDATION_ERROR" });
  }

  for (const item of prepared) {
    const orderData = item.shipment.orders as { id?: string; source?: string } | null;
    logInfo("india_post.booking.dispatch", {
      source: String(orderData?.source || "UNKNOWN").toUpperCase(),
      orderId: item.shipment.order_id,
      shipmentId: item.shipment.id,
      weightGrams: item.payload.physical_weight,
      lengthCm: item.payload.length,
      widthCm: item.payload.breadth_diameter,
      heightCm: item.payload.height,
      breadthDiameter: item.payload.breadth_diameter,
      shapeOfArticle: item.payload.shape_of_article,
      serviceCode: item.shipment.service_code,
    });
  }

  const transport = indiaPostBookingTransport(prepared.length);
  const articles = prepared.map((item) => item.payload);
  const { timed } = await import("@/lib/jobs/timing");
  const indiaPostEnv = connection.environment === "PRODUCTION" ? "PRODUCTION" : "UAT";
  logInfo("booking.cept_call", {
    INDIA_POST_ENV: indiaPostEnv,
    organizationId: input.organizationId,
    jobId: input.jobId,
    connectionId: connection.id,
    articleCount: articles.length,
    transport,
    shipmentId: prepared[0]?.shipment.id,
    orderId: prepared[0]?.shipment.order_id,
  });
  let result: IndiaPostBookingResponse | null = null;
  let submissionOpened = false;
  try {
    result = (await withIndiaPostBookingLock(
      supabase,
      {
        organizationId: input.organizationId,
        jobId: input.jobId,
        shipmentId: prepared[0]?.shipment.id,
        connectionId: String(connection.id ?? ""),
      },
      async () => {
        const intentAt = new Date().toISOString();
        for (const item of prepared) {
          const reloaded = await reloadShipmentForSubmit(supabase, item.shipment.id, input.organizationId);
          if (reloaded) {
            if (String(reloaded.organization_id ?? "") && String(reloaded.organization_id) !== input.organizationId) {
              throw Object.assign(new Error("Shipment is outside this organization."), { code: "BOOKING_REVIEW_REQUIRED" });
            }
            if (reloaded.booked_at || isAuthoritativeIndiaPostBooking(reloaded)) {
              throw Object.assign(new Error("This shipment is already booked with India Post."), { code: "CEPT_UNKNOWN", bookingPhase: "POST_SUBMIT" });
            }
            if (readCeptSubmitIntentAt(reloaded.metadata)) {
              throw Object.assign(new Error("Booking outcome could not be confirmed. The article was not submitted again."), {
                code: "CEPT_UNKNOWN",
                bookingPhase: "POST_SUBMIT",
                shipmentIds: [item.shipment.id],
              });
            }
            const currentBarcode = shipmentBarcode(reloaded.barcode);
            if (currentBarcode && currentBarcode !== item.barcode) {
              throw Object.assign(new Error("Booking needs review before it can be submitted."), {
                code: "BOOKING_REVIEW_REQUIRED",
                shipmentIds: [item.shipment.id],
              });
            }
            if (!item.allocatedThisRun && !existingBarcodeMayBeSubmitted(reloaded) && !trustedFirstBarcodeProof(reloaded)) {
              throw Object.assign(new Error("Booking needs review before it can be submitted."), {
                code: "BOOKING_REVIEW_REQUIRED",
                shipmentIds: [item.shipment.id],
              });
            }
          } else if (!item.allocatedThisRun && !item.provenFirstBarcode) {
            throw Object.assign(new Error("Booking needs review before it can be submitted."), {
              code: "BOOKING_REVIEW_REQUIRED",
              shipmentIds: [item.shipment.id],
            });
          }
          const nextMetadata = metadataWithCeptSubmitIntent(reloaded?.metadata ?? item.shipment.metadata, intentAt);
          const { data: intentSaved, error: intentError } = await supabase
            .from("shipments")
            .update({ metadata: nextMetadata })
            .eq("id", item.shipment.id)
            .eq("organization_id", input.organizationId)
            .is("booked_at", null)
            .filter("metadata->>ceptSubmitIntentAt", "is", null)
            .select("id")
            .maybeSingle();
          if (intentError) {
            throw Object.assign(new Error(intentError.message), { code: "PRE_POST_TRANSIENT", bookingPhase: "PRE_POST" });
          }
          if (!intentSaved) {
            const blocked = reloaded ? await reloadShipmentForSubmit(supabase, item.shipment.id, input.organizationId) : null;
            if (blocked?.booked_at || readCeptSubmitIntentAt(blocked?.metadata) || isAuthoritativeIndiaPostBooking(blocked ?? {})) {
              throw Object.assign(new Error("Booking outcome could not be confirmed. The article was not submitted again."), {
                code: "CEPT_UNKNOWN",
                bookingPhase: "POST_SUBMIT",
                shipmentIds: [item.shipment.id],
              });
            }
            throw Object.assign(new Error("Booking intent was not stored. The provider was not called."), {
              code: "PRE_POST_TRANSIENT",
              bookingPhase: "PRE_POST",
            });
          }
          item.shipment.metadata = nextMetadata;
        }
        submissionOpened = true;
        return timed(
          "india_post.book",
          {
            organizationId: input.organizationId,
            jobId: input.jobId,
            connectionId: connection.id,
            articleCount: articles.length,
            transport,
            shipmentId: prepared[0]?.shipment.id,
          },
          () =>
            transport === "file"
              ? provider.bookShipmentFile(articles)
              : provider.bookShipment({ articles })
        );
      }
    )) as IndiaPostBookingResponse;
  } catch (error) {
    if (!submissionOpened) throw tagPrePostBookingError(error);
    const message = error instanceof Error ? error.message : "India Post booking failed.";
    const classified = classifyProviderError(error);
    logError("booking.cept_failed", {
      INDIA_POST_ENV: indiaPostEnv,
      organizationId: input.organizationId,
      jobId: input.jobId,
      connectionId: connection.id,
      shipmentId: prepared[0]?.shipment.id,
      orderId: prepared[0]?.shipment.order_id,
      provider: "india-post",
      provider_status: classified.httpStatus ?? (error as { status?: number }).status,
      provider_error_code: classified.code,
      provider_message: message,
      barcodeRef: barcodeLogRef(prepared[0]?.barcode),
      httpStatus: classified.httpStatus ?? (error as { status?: number }).status,
      errorCode: classified.code,
      retryable: classified.retryable,
      outcome: classified.code,
      message,
    });
    if (isIndiaPostDuplicateArticleMessage(message)) {
      logInfo("booking.duplicate_response", {
        organizationId: input.organizationId,
        jobId: input.jobId,
        shipmentId: prepared[0]?.shipment.id,
        barcodeRef: barcodeLogRef(prepared[0]?.barcode),
      });
      for (const item of prepared) {
        bookedIds.push(item.shipment.id);
        await persistBookedShipment(supabase, {
          organizationId: input.organizationId,
          shipmentId: item.shipment.id,
          orderId: item.shipment.order_id,
          barcode: item.barcode,
          articleId: item.barcode,
          persistDefaults: item.persistDefaults,
          payload: item.payload,
        });
      }
      logInfo("booking.cept_success", {
        organizationId: input.organizationId,
        duplicate: true,
        booked: bookedIds.length,
      });
      assertShipmentsClassified({
        requestedIds: input.shipmentIds,
        bookedIds,
        failedIds,
        preparedIds: prepared.map((item) => item.shipment.id),
      });
      return { booked: bookedIds.length, failed: failedIds.length, bookedIds, failedIds, prepared, result: null };
    }
    const networkFailure = /timeout|econn|network|temporar/i.test(message) || classified.code === "ETIMEDOUT" || classified.code === "ECONNRESET" || classified.code === "ECONNREFUSED";
    if (isRetryableCeptUncertainty(error) || classified.code === "ETIMEDOUT" || networkFailure || (classified.httpStatus ?? 0) >= 500 || /^HTTP_5\d\d$/.test(classified.code)) {
      logError("booking.cept_unknown", {
        organizationId: input.organizationId,
        jobId: input.jobId,
        shipmentId: prepared.map((item) => item.shipment.id),
        message,
        outcome: "CEPT_UNKNOWN",
      });
      throw Object.assign(
        new Error("India Post booking outcome is unknown after the request was sent. The article was not submitted again."),
        {
          code: "CEPT_UNKNOWN",
          bookingPhase: "POST_SUBMIT",
          status: classified.httpStatus,
          shipmentIds: prepared.map((item) => item.shipment.id),
        }
      );
    }
    if (classified.code === "CEPT_UNKNOWN") {
      throw Object.assign(new Error(message), {
        code: "CEPT_UNKNOWN",
        bookingPhase: "POST_SUBMIT",
        status: classified.httpStatus ?? 409,
        shipmentIds: prepared.map((item) => item.shipment.id),
      });
    }
    throw Object.assign(error instanceof Error ? error : new Error(message), {
      code: classified.code,
      shipmentIds: prepared.map((item) => item.shipment.id),
    });
  }

  const split = splitIndiaPostBookingResult(result);
  logInfo("booking.cept_success", {
    organizationId: input.organizationId,
    jobId: input.jobId,
    valid: split.valid.size,
    failed: split.failed.size,
  });

  await Promise.all(
    prepared.map(async (item) => {
      const key = item.barcode.toUpperCase();
      const ok = split.valid.get(key);
      if (ok) {
        if (ok.duplicate) {
          logInfo("booking.duplicate_response", {
            organizationId: input.organizationId,
            shipmentId: item.shipment.id,
            barcodeRef: barcodeLogRef(item.barcode),
          });
        }
        bookedIds.push(item.shipment.id);
        await persistBookedShipment(supabase, {
          organizationId: input.organizationId,
          shipmentId: item.shipment.id,
          orderId: item.shipment.order_id,
          barcode: item.barcode,
          articleId: ok.articleId,
          tariff: ok.tariff,
          batchId: split.batchId,
          correlationId: split.correlationId,
          persistDefaults: item.persistDefaults,
          payload: item.payload,
        });
        return;
      }
      const message = split.failed.get(key) || "Booking rejected.";
      if (isIndiaPostDuplicateArticleMessage(message)) {
        bookedIds.push(item.shipment.id);
        await persistBookedShipment(supabase, {
          organizationId: input.organizationId,
          shipmentId: item.shipment.id,
          orderId: item.shipment.order_id,
          barcode: item.barcode,
          articleId: item.barcode,
          persistDefaults: item.persistDefaults,
          payload: item.payload,
        });
        return;
      }
      failedIds.push(item.shipment.id);
      await markShipmentBookingFailed(supabase, item.shipment.id, message, "INDIA_POST_VALIDATION", input.organizationId);
      if (prepared.length === 1) {
        throw Object.assign(new Error(message), { code: "VALIDATION_ERROR" });
      }
    })
  );

  for (const id of reviewIds) {
    if (!failedIds.includes(id) && !bookedIds.includes(id)) failedIds.push(id);
  }
  assertShipmentsClassified({
    requestedIds: input.shipmentIds,
    bookedIds,
    failedIds,
    preparedIds: prepared.map((item) => item.shipment.id),
  });
  return { booked: bookedIds.length, failed: failedIds.length, bookedIds, failedIds, prepared, result };
}
