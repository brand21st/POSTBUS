import { createAdminClient } from "@/lib/supabase/admin";
import { classifyProviderError, delayForAttempt, MAX_ATTEMPTS } from "@/lib/jobs/retry";
import { logError } from "@/lib/logger";
import { encryptSecret } from "@/lib/security/crypto";
import {
  AUTOMATION_DEFAULTS,
  getAutomationSettings,
  isAutoShopifySyncEnabled,
  mapAutomationSettings,
} from "@/modules/automation/service";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import { formatBarcode, indiaPostAcceptedArticleId, isCeptUatTestSeries } from "@/modules/india-post/barcode";
import {
  indiaPostBookingArticle,
  indiaPostMobile,
  indiaPostRequiredText,
} from "@/modules/india-post/endpoints";
import { resolveIndiaPostOrigin } from "@/modules/india-post/origin";
import { fetchOfficialIndiaPostLabelPdf } from "@/modules/labels/official-fetch";
import { persistPackingSlip } from "@/modules/labels/packing-fetch";
import { persistLabelPdf } from "@/modules/labels/persist";
import { organizationLabelSender } from "@/modules/organizations/label-sender";
import { DEFAULT_INDIA_POST_SERVICE, indiaPostServiceLabel } from "@/types/domain";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { JobPayload } from "@/lib/queue/queues";
import type { AutomationSettings } from "@/types/api";

export async function processJob(queue: string, payload: JobPayload) {
  const supabase = createAdminClient();
  const jobId = payload.jobId;

  await supabase
    .from("background_jobs")
    .update({ status: "RUNNING", started_at: new Date().toISOString() })
    .eq("id", jobId);

  try {
    if (queue === "shipment-booking") await bookShipment(supabase, payload);
    else if (queue === "label-generation") await generateLabel(supabase, payload);
    else if (queue === "invoice-generation") await generateInvoice(supabase, payload);
    else if (queue === "manifest-generation") await generateManifest(supabase, payload);
    else if (queue === "tracking-sync") await syncTracking(supabase, payload);
    else if (queue === "shopify-sync") await shopifySync(supabase, payload);
    else if (queue === "shopify-fulfillment") await shopifyFulfillment(supabase, payload);
    else if (queue === "webhook-processing") await deliverWebhooks(supabase, payload);
    else if (queue === "wati-notify") {
      const { sendWatiNotice, watiEventFromJobProgress, watiIdsFromJob } = await import("@/modules/wati/send");
      const { data: job } = await supabase
        .from("background_jobs")
        .select("progress")
        .eq("id", jobId)
        .maybeSingle();
      const ids = watiIdsFromJob(job?.progress, payload.entityId);
      if (!ids.shipmentId && !ids.orderId) {
        throw Object.assign(new Error("Order or shipment id is missing for Wati notify."), {
          code: "VALIDATION_ERROR",
        });
      }
      await sendWatiNotice(
        supabase,
        payload.organizationId,
        watiEventFromJobProgress(job?.progress),
        ids
      );
    }
    else if (queue === "india-post-events") {
      const { processIndiaPostInboxEvent } = await import("@/modules/india-post/webhook");
      if (!payload.entityId) {
        throw Object.assign(new Error("Webhook inbox id is missing."), { code: "VALIDATION_ERROR" });
      }
      await processIndiaPostInboxEvent(supabase, payload.entityId, payload.organizationId);
    }
    else {
      // notifications / cleanup / reports reserved
    }

    await supabase
      .from("background_jobs")
      .update({ status: "SUCCEEDED", completed_at: new Date().toISOString(), last_error: null })
      .eq("id", jobId);
  } catch (error) {
    const classified = classifyProviderError(error);
    const { data: job } = await supabase
      .from("background_jobs")
      .select("attempt_count, max_attempts")
      .eq("id", jobId)
      .single();
    const attempt = (job?.attempt_count ?? 0) + 1;
    const retryable = classified.retryable && attempt < (job?.max_attempts ?? MAX_ATTEMPTS);
    await supabase.from("shipment_job_attempts").insert({
      organization_id: payload.organizationId,
      job_id: jobId,
      shipment_id: payload.entityType === "shipment" ? payload.entityId : null,
      attempt_number: attempt,
      status: retryable ? "RETRYING" : "FAILED",
      error: classified.message,
      error_code: classified.code,
      retryable,
      finished_at: new Date().toISOString(),
    });
    await supabase
      .from("background_jobs")
      .update({
        status: retryable ? "RETRYING" : "FAILED",
        attempt_count: attempt,
        last_error: classified.message,
        last_error_code: classified.code,
        next_attempt_at: retryable
          ? new Date(Date.now() + delayForAttempt(attempt)).toISOString()
          : null,
      })
      .eq("id", jobId);

    if (queue !== "invoice-generation" && payload.entityType === "shipment" && payload.entityId) {
      await supabase
        .from("shipments")
        .update({
          status: retryable ? "QUEUED" : "FAILED",
          last_error: classified.message,
          last_error_code: classified.code,
        })
        .eq("id", payload.entityId);
      await supabase.from("notifications").insert({
        organization_id: payload.organizationId,
        type: retryable ? "shipment.retrying" : "shipment.failed",
        title: retryable ? "Shipment retry scheduled" : "Shipment failed",
        body: classified.message,
        entity_type: "shipment",
        entity_id: payload.entityId,
      });
    }

    if (!retryable) throw error;
    throw error;
  }
}

async function bookShipment(supabase: ReturnType<typeof createAdminClient>, payload: JobPayload) {
  try {
    const { checkQuota } = await import("@/modules/billing/usage");
    await checkQuota(supabase, payload.organizationId, 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Billing quota exceeded.";
    await supabase
      .from("shipments")
      .update({ status: "FAILED", last_error: message, last_error_code: "BILLING_LIMIT" })
      .eq("id", payload.entityId);
    throw Object.assign(new Error(message), { code: "VALIDATION_ERROR" });
  }

  const { data: shipment } = await supabase
    .from("shipments")
    .select("*, orders(*), customers(*), addresses:shipping_address_id(*)")
    .eq("id", payload.entityId)
    .single();
  if (!shipment) throw Object.assign(new Error("Shipment not found."), { code: "VALIDATION_ERROR" });

  const { data: connection } = await supabase
    .from("india_post_connections")
    .select("*")
    .eq("organization_id", payload.organizationId)
    .maybeSingle();

  if (!connection || connection.status === "NOT_CONNECTED") {
    throw Object.assign(new Error("India Post is not connected."), {
      code: "PERMANENT_AUTH_ERROR",
    });
  }

  const serviceCode = (shipment.service_code as string) || DEFAULT_INDIA_POST_SERVICE;

  // India Post issues one contract per product, so the shipment's service decides
  // which contract books it. The legacy single contract stays as a fallback.
  const { data: contract } = await supabase
    .from("india_post_contracts")
    .select("contract_id")
    .eq("organization_id", payload.organizationId)
    .eq("service_code", serviceCode)
    .eq("is_active", true)
    .maybeSingle();

  const contractId = (contract?.contract_id as string | undefined) || connection.contract_id;
  if (!contractId) {
    throw Object.assign(
      new Error(
        `No India Post contract is set for ${indiaPostServiceLabel(serviceCode)}. Add it on the India Post integration page.`
      ),
      { code: "INVALID_CONTRACT" }
    );
  }

  // Prefer a series allotted for this service, else the workspace-wide one.
  const { data: ranges, error: rangeError } = await supabase
    .from("barcode_ranges")
    .select("*")
    .eq("organization_id", payload.organizationId)
    .eq("is_active", true)
    .or(`service_code.eq.${serviceCode},service_code.is.null`);
  if (rangeError) {
    throw Object.assign(new Error(rangeError.message), { code: "INVALID_BARCODE" });
  }

  const range =
    (ranges ?? []).find((item) => item.service_code === serviceCode) ??
    (ranges ?? []).find((item) => item.service_code === null);

  if (!range) {
    throw Object.assign(
      new Error(
        `No barcode range is set for ${indiaPostServiceLabel(serviceCode)}. Add the series India Post allotted you.`
      ),
      { code: "INVALID_BARCODE" }
    );
  }
  if (range.next_number > range.end_number) {
    throw Object.assign(
      new Error(
        `The barcode range for ${indiaPostServiceLabel(serviceCode)} is used up (ended at ${range.end_number}). Add a new series.`
      ),
      { code: "INVALID_BARCODE" }
    );
  }
  if (
    connection.environment === "PRODUCTION" &&
    isCeptUatTestSeries(String(range.prefix), Number(range.start_number), Number(range.end_number))
  ) {
    throw Object.assign(
      new Error(
        "21433001–21434000 is the CEPT UAT test serial range. India Post will not show those articles in your production dashboard. Save the CL series from My Bookings (for example CL556973995IN uses serial 55697399)."
      ),
      { code: "INVALID_BARCODE" }
    );
  }

  const barcode = formatBarcode(range.prefix, range.next_number, range.suffix);
  await supabase
    .from("barcode_ranges")
    .update({ next_number: range.next_number + 1 })
    .eq("id", range.id);

  await supabase.from("shipments").update({ status: "BOOKING", barcode }).eq("id", shipment.id);

  const provider = indiaPostFromRow(connection);
  const tokens = await provider.login();
  await supabase
    .from("india_post_connections")
    .update({
      encrypted_access_token: encryptSecret(tokens.access_token),
      encrypted_refresh_token: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
      encrypted_id_token: tokens.id_token ? encryptSecret(tokens.id_token) : null,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(Date.now() + tokens.refresh_expires_in * 1000).toISOString(),
      last_refreshed_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  const address = shipment.addresses as {
    name?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    pincode?: string;
    phone?: string;
  } | null;

  const receiverMobile = indiaPostMobile(address?.phone);
  if (!receiverMobile) {
    throw Object.assign(
      new Error("Receiver mobile must be a 10-digit Indian number starting with 6, 7, 8 or 9."),
      { code: "VALIDATION_ERROR" }
    );
  }

  const destPincode = address?.pincode ?? "";
  if (!/^\d{6}$/.test(destPincode)) {
    throw Object.assign(new Error("Receiver pincode must be exactly 6 digits."), {
      code: "VALIDATION_ERROR",
    });
  }

  const { data: pickup } = await supabase
    .from("pickup_locations")
    .select("*")
    .eq("organization_id", payload.organizationId)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: org } = await supabase
    .from("organizations")
    .select("name, phone, line1, line2, city, state, pincode")
    .eq("id", payload.organizationId)
    .maybeSingle();
  const { data: shop } = await supabase
    .from("shopify_stores")
    .select("shop_name")
    .eq("organization_id", payload.organizationId)
    .maybeSingle();

  const sender = organizationLabelSender(org, pickup, shop?.shop_name);
  const origin = await resolveIndiaPostOrigin(
    provider,
    connection,
    {
      ...pickup,
      pincode: sender.pincode || pickup?.pincode,
      city: sender.city || pickup?.city,
      state: sender.state || pickup?.state,
    },
    destPincode
  );
  const senderMobile = indiaPostMobile(sender.phone) || receiverMobile;
  const senderName = indiaPostRequiredText(sender.name, "Merchant");

  const weightGrams = Number(shipment.weight_grams) || 100;
  const result = await provider.bookShipment({
    articles: [
      indiaPostBookingArticle({
        customerId: String(connection.bulk_customer_id ?? ""),
        contractId,
        barcode,
        officeId: origin.officeId,
        originPin: origin.pincode,
        serviceCode,
        weightGrams,
        lengthCm: Number(shipment.length_cm) || 0,
        widthCm: Number(shipment.width_cm) || 0,
        heightCm: Number(shipment.height_cm) || 0,
        senderName,
        senderCompany: org?.name || pickup?.name || senderName,
        senderLine1: sender.line1,
        senderLine2: [sender.line2, senderMobile ? `Ph:${senderMobile}` : ""].filter((value) => value.trim().length >= 3).join(", "),
        senderCity: sender.city || origin.city,
        senderState: sender.state || origin.state,
        senderMobile,
        receiverName: address?.name ?? "Customer",
        receiverLine1: address?.line1 ?? "",
        receiverLine2: [address?.line2, `Ph:${receiverMobile}`].filter((value) => (value ?? "").trim().length >= 3).join(", "),
        receiverCity: address?.city ?? "",
        receiverState: address?.state ?? "",
        receiverPin: destPincode,
        receiverMobile,
      }),
    ],
  });

  const valid = result?.valid_articles?.[0];
  if (!valid) {
    const firstError = result?.error_articles?.[0]?.errors?.[0] || "Booking rejected.";
    throw Object.assign(new Error(firstError), { code: "VALIDATION_ERROR" });
  }

  const articleId = indiaPostAcceptedArticleId(valid, barcode);

  await supabase
    .from("shipments")
    .update({
      status: "BOOKED",
      tracking_number: articleId,
      barcode: articleId,
      tariff_amount: valid.calculated_tariff ?? null,
      provider_ref: result.batch_id ?? null,
      booked_at: new Date().toISOString(),
    })
    .eq("id", shipment.id);

  await supabase.from("orders").update({ status: "BOOKED" }).eq("id", shipment.order_id);
  if (shipment.order_id) {
    try {
      const { insertOrderStageNotification } = await import("@/lib/notifications/order-stage");
      await insertOrderStageNotification(supabase, {
        organizationId: payload.organizationId,
        orderId: shipment.order_id,
        event: "booked",
      });
    } catch {
      // In-app alerts are optional; booking should still succeed.
    }
  }
  try {
    const { consumeQuota } = await import("@/modules/billing/usage");
    await consumeQuota(supabase, payload.organizationId);
  } catch (error) {
    logError("BILLING_QUOTA_CONSUME_FAILED", {
      organizationId: payload.organizationId,
      shipmentId: shipment.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    await supabase.from("usage_events").insert({
      organization_id: payload.organizationId,
      metric: "shipments",
      quantity: 1,
    });
  }

  const automation = await loadAutomation(supabase, payload.organizationId);

  const { createBackgroundJob } = await import("@/modules/jobs/service");
  await createBackgroundJob(supabase, {
    organizationId: payload.organizationId,
    jobType: "label-generation",
    entityType: "shipment",
    entityId: shipment.id,
  });
  try {
    await createBackgroundJob(supabase, {
      organizationId: payload.organizationId,
      jobType: "invoice-generation",
      entityType: "shipment",
      entityId: shipment.id,
    });
  } catch (error) {
    logError("INVOICE_JOB_ENQUEUE_FAILED", {
      organizationId: payload.organizationId,
      shipmentId: shipment.id,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
  if (automation.autoShopifyFulfillment) {
    await createBackgroundJob(supabase, {
      organizationId: payload.organizationId,
      jobType: "shopify-fulfillment",
      entityType: "shipment",
      entityId: shipment.id,
    });
  }
  if (automation.autoTrackingSync) {
    await createBackgroundJob(supabase, {
      organizationId: payload.organizationId,
      jobType: "tracking-sync",
      entityType: "shipment",
      entityId: shipment.id,
    });
  }
  const { enqueueWatiNotify } = await import("@/modules/wati/send");
  await enqueueWatiNotify(supabase, payload.organizationId, "booked", {
    shipmentId: shipment.id,
    orderId: shipment.order_id,
  });
}

async function loadAutomation(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string
): Promise<AutomationSettings> {
  try {
    return await getAutomationSettings(supabase, organizationId);
  } catch {
    return mapAutomationSettings({ organization_id: organizationId, ...AUTOMATION_DEFAULTS });
  }
}

async function generateInvoice(supabase: ReturnType<typeof createAdminClient>, payload: JobPayload) {
  if (!payload.entityId) {
    throw Object.assign(new Error("Shipment is missing."), { code: "VALIDATION_ERROR" });
  }
  const { generateShippingInvoice } = await import("@/modules/invoices/service");
  await generateShippingInvoice(supabase, payload.organizationId, payload.entityId);
}

async function generateLabel(supabase: ReturnType<typeof createAdminClient>, payload: JobPayload) {
  if (!payload.entityId) {
    throw Object.assign(new Error("Shipment is missing."), { code: "VALIDATION_ERROR" });
  }
  const officialPdf = await fetchOfficialIndiaPostLabelPdf(supabase, payload.organizationId, payload.entityId);
  const official = await persistLabelPdf(supabase, {
    organizationId: payload.organizationId,
    shipmentId: officialPdf.shipmentId,
    kind: "INDIA_POST",
    bytes: officialPdf.pdf,
  });
  await supabase.from("shipments").update({ status: "LABEL_READY" }).eq("id", officialPdf.shipmentId);

  try {
    await persistPackingSlip(supabase, payload.organizationId, officialPdf.shipmentId, { replace: true });
  } catch (error) {
    logError("PACKING_LABEL_FAILED", {
      organizationId: payload.organizationId,
      shipmentId: officialPdf.shipmentId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }

  const automation = await loadAutomation(supabase, payload.organizationId);
  if (automation.autoLabelPrinting) {
    const { enqueueAutoPrintJob } = await import("@/modules/print/service");
    try {
      await enqueueAutoPrintJob(supabase, {
        organizationId: payload.organizationId,
        shipmentId: officialPdf.shipmentId,
        labelId: official.id,
        paperSize: "A6",
      });
    } catch (error) {
      logError("PRINT_JOB_ENQUEUE_FAILED", {
        organizationId: payload.organizationId,
        shipmentId: officialPdf.shipmentId,
        labelId: official.id,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  const { createBackgroundJob } = await import("@/modules/jobs/service");
  if (automation.autoManifest) {
    await createBackgroundJob(supabase, {
      organizationId: payload.organizationId,
      jobType: "manifest-generation",
      entityType: "shipment",
      entityId: officialPdf.shipmentId,
    });
  }
}

async function generateManifest(supabase: ReturnType<typeof createAdminClient>, payload: JobPayload) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const name = `Manifest ${day}`;
  const dayStart = `${day}T00:00:00+05:30`;

  const { data: shipments } = await supabase
    .from("shipments")
    .select("id, barcode, tracking_number, service_code, tariff_amount, orders(order_number)")
    .eq("organization_id", payload.organizationId)
    .not("barcode", "is", null)
    .not("booked_at", "is", null)
    .gte("booked_at", dayStart)
    .in("status", ["BOOKED", "LABEL_READY", "MANIFEST_PENDING", "MANIFEST_READY"])
    .order("booked_at", { ascending: true });

  if (!shipments?.length) {
    return;
  }

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(`PostBus pickup manifest  ${day}`, { x: 40, y: 800, size: 16, font });
  page.drawText("Kolenchery SO drop-off  |  India Post", { x: 40, y: 780, size: 10, font });
  shipments.forEach((item, index) => {
    const order = item.orders as { order_number?: string } | null;
    page.drawText(
      `${index + 1}. ${item.barcode ?? ""}  ${order?.order_number ?? ""}  ${item.service_code ?? ""}`,
      { x: 40, y: 750 - index * 16, size: 10, font }
    );
  });
  const bytes = await pdf.save();

  const { data: existing } = await supabase
    .from("manifests")
    .select("id")
    .eq("organization_id", payload.organizationId)
    .eq("name", name)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const path = `${payload.organizationId}/manifest-${day}.pdf`;
  await supabase.storage.from("manifests").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  const { data: signed } = await supabase.storage
    .from("manifests")
    .createSignedUrl(path, 60 * 60 * 24 * 7);

  const fields = {
    status: "READY",
    file_path: path,
    file_url: signed?.signedUrl ?? null,
    shipment_count: shipments.length,
    updated_at: new Date().toISOString(),
  };

  const manifest = existing
    ? (
        await supabase.from("manifests").update(fields).eq("id", existing.id).select().single()
      ).data
    : (
        await supabase
          .from("manifests")
          .insert({
            organization_id: payload.organizationId,
            name,
            ...fields,
          })
          .select()
          .single()
      ).data;

  if (!manifest) {
    throw Object.assign(new Error("Could not save the pickup manifest."), {
      code: "PROVIDER_ERROR",
    });
  }

  await supabase.from("manifest_shipments").delete().eq("manifest_id", manifest.id);
  await supabase.from("manifest_shipments").insert(
    shipments.map((item) => ({
      organization_id: payload.organizationId,
      manifest_id: manifest.id,
      shipment_id: item.id,
    }))
  );
  await supabase
    .from("shipments")
    .update({ status: "MANIFEST_READY" })
    .in(
      "id",
      shipments.map((item) => item.id)
    );

  const automation = await loadAutomation(supabase, payload.organizationId);
  if (automation.autoShopifyFulfillment) {
    const { createBackgroundJob } = await import("@/modules/jobs/service");
    for (const item of shipments) {
      await createBackgroundJob(supabase, {
        organizationId: payload.organizationId,
        jobType: "shopify-fulfillment",
        entityType: "shipment",
        entityId: item.id,
      });
    }
  }
}

async function syncTracking(supabase: ReturnType<typeof createAdminClient>, payload: JobPayload) {
  const automation = await loadAutomation(supabase, payload.organizationId);
  if (!automation.autoTrackingSync) {
    return;
  }
  const { data: connection } = await supabase
    .from("india_post_connections")
    .select("*")
    .eq("organization_id", payload.organizationId)
    .maybeSingle();
  if (!connection) {
    throw Object.assign(new Error("India Post is not connected."), { code: "PERMANENT_AUTH_ERROR" });
  }
  const { data: shipments } = await supabase
    .from("shipments")
    .select("id, barcode, status, order_id")
    .eq("organization_id", payload.organizationId)
    .not("barcode", "is", null)
    .in("status", ["BOOKED", "LABEL_READY", "MANIFEST_READY", "IN_TRANSIT", "OUT_FOR_DELIVERY"]);
  const barcodes = (shipments ?? []).map((item) => item.barcode).filter(Boolean) as string[];
  if (!barcodes.length) return;
  const provider = indiaPostFromRow(connection);
  const result = (await provider.trackShipment(barcodes)) as {
    data?: Array<{
      booking_details?: { article_number?: string };
      tracking_details?: Array<{ event?: string; office?: string; date?: string; time?: string }>;
      del_status?: { del_status?: string };
    }>;
  };
  for (const article of result.data ?? []) {
    const barcode = article.booking_details?.article_number;
    const shipment = shipments?.find((item) => item.barcode === barcode);
    if (!shipment) continue;
    for (const event of article.tracking_details ?? []) {
      const { error } = await supabase.from("tracking_events").insert({
        organization_id: payload.organizationId,
        shipment_id: shipment.id,
        event_code: event.event ?? "EVENT",
        event_description: event.event,
        office_name: event.office,
        occurred_at: event.date ?? new Date().toISOString(),
        raw: event,
      });
      if (error && error.code !== "23505") throw error;
    }
    const delivered = article.del_status?.del_status?.toLowerCase() === "delivered";
    const alreadyDelivered = shipment.status === "DELIVERED";
    const alreadyMoving = ["IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"].includes(shipment.status);
    let nextStage: "in_transit" | "delivered" | null = null;
    if (delivered && !alreadyDelivered) {
      nextStage = "delivered";
      await supabase.from("shipments").update({ status: "DELIVERED" }).eq("id", shipment.id);
      if (shipment.order_id) {
        await supabase.from("orders").update({ status: "DELIVERED" }).eq("id", shipment.order_id);
      }
    } else if (!delivered && !alreadyMoving && (article.tracking_details?.length ?? 0) > 0) {
      nextStage = "in_transit";
      await supabase.from("shipments").update({ status: "IN_TRANSIT" }).eq("id", shipment.id);
      if (shipment.order_id) {
        await supabase.from("orders").update({ status: "IN_TRANSIT" }).eq("id", shipment.order_id);
      }
    }
    if (nextStage && shipment.order_id) {
      try {
        const { insertOrderStageNotification } = await import("@/lib/notifications/order-stage");
        await insertOrderStageNotification(supabase, {
          organizationId: payload.organizationId,
          orderId: shipment.order_id,
          event: nextStage,
        });
      } catch {
        // In-app alerts are optional; tracking still updates.
      }
      try {
        const { enqueueWatiNotify } = await import("@/modules/wati/send");
        await enqueueWatiNotify(supabase, payload.organizationId, nextStage, {
          shipmentId: shipment.id,
          orderId: shipment.order_id,
        });
      } catch {
        // WhatsApp is optional; tracking still updates.
      }
      if (automation.autoShopifyFulfillment) {
        try {
          const { syncShopifyOrderStage } = await import("@/modules/shopify/orders");
          await syncShopifyOrderStage(supabase, {
            organizationId: payload.organizationId,
            orderId: shipment.order_id,
            shipmentId: shipment.id,
            stage: nextStage,
          });
        } catch {
          // Shopify fulfillment events are optional.
        }
      }
    }
  }
}

async function shopifySync(supabase: ReturnType<typeof createAdminClient>, payload: JobPayload) {
  if (!(await isAutoShopifySyncEnabled(supabase, payload.organizationId))) return;
  const { syncUnfulfilledShopifyOrders } = await import("@/modules/shopify/orders");
  const result = await syncUnfulfilledShopifyOrders(supabase, {
    organizationId: payload.organizationId,
    userId: payload.userId,
  });
  if (!result.connected) {
    throw Object.assign(new Error("Shopify is not connected."), { code: "PERMANENT_AUTH_ERROR" });
  }
  await supabase
    .from("background_jobs")
    .update({ progress: { imported: result.imported, updated: result.updated, skipped: result.skipped } })
    .eq("id", payload.jobId);
}

async function shopifyFulfillment(
  supabase: ReturnType<typeof createAdminClient>,
  payload: JobPayload
) {
  const automation = await loadAutomation(supabase, payload.organizationId);
  if (!automation.autoShopifyFulfillment) return;
  const { data: job } = await supabase
    .from("background_jobs")
    .select("progress")
    .eq("id", payload.jobId)
    .maybeSingle();
  const { shopifyStageFromJobProgress, syncShopifyOrderStage, fulfillShopifyShipment, notifyShopifyProcessingWati } =
    await import("@/modules/shopify/orders");
  const stage = shopifyStageFromJobProgress(job?.progress);
  if (stage === "processing" || stage === "in_transit" || stage === "delivered") {
    const progress =
      job?.progress && typeof job.progress === "object"
        ? (job.progress as { orderId?: string | null; shipmentId?: string | null })
        : {};
    const orderId = progress.orderId ?? payload.entityId;
    if (!orderId) {
      throw Object.assign(new Error("Order id is missing for Shopify stage sync."), {
        code: "VALIDATION_ERROR",
      });
    }
    const result = await syncShopifyOrderStage(supabase, {
      organizationId: payload.organizationId,
      orderId,
      shipmentId: progress.shipmentId ?? (payload.entityType === "shipment" ? payload.entityId : null),
      stage,
    });
    if (stage === "processing" && result && (!result.skipped || ("tagged" in result && result.tagged))) {
      await notifyShopifyProcessingWati(supabase, payload.organizationId, orderId);
    }
    await supabase.from("background_jobs").update({ progress: result }).eq("id", payload.jobId);
    return;
  }
  if (!payload.entityId) {
    throw Object.assign(new Error("Shipment id is missing."), { code: "VALIDATION_ERROR" });
  }
  const result = await fulfillShopifyShipment(supabase, {
    organizationId: payload.organizationId,
    shipmentId: payload.entityId,
  });
  await supabase
    .from("background_jobs")
    .update({ progress: result })
    .eq("id", payload.jobId);
}

async function deliverWebhooks(supabase: ReturnType<typeof createAdminClient>, payload: JobPayload) {
  const { data: deliveries } = await supabase
    .from("webhook_deliveries")
    .select("*, webhook_endpoints(*)")
    .eq("organization_id", payload.organizationId)
    .eq("status", "PENDING")
    .limit(20);

  for (const delivery of deliveries ?? []) {
    const endpoint = delivery.webhook_endpoints as {
      url?: string;
      encrypted_secret?: string | null;
    } | null;
    if (!endpoint?.url) continue;
    const timestamp = String(Date.now());
    const body = JSON.stringify(delivery.payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-PostBus-Timestamp": timestamp,
    };
    if (endpoint.encrypted_secret) {
      try {
        const { decryptSecret } = await import("@/lib/security/crypto");
        const { signWebhook } = await import("@/modules/webhooks/outgoing");
        const secret = decryptSecret(endpoint.encrypted_secret);
        headers["X-PostBus-Signature"] = signWebhook(secret, timestamp, body);
      } catch (error) {
        await supabase
          .from("webhook_deliveries")
          .update({
            status: "FAILED",
            last_error: error instanceof Error ? error.message : "Could not sign webhook payload.",
            attempt_count: delivery.attempt_count + 1,
          })
          .eq("id", delivery.id);
        continue;
      }
    }
    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers,
        body,
      });
      await supabase
        .from("webhook_deliveries")
        .update({
          status: response.ok ? "DELIVERED" : "FAILED",
          response_code: response.status,
          attempt_count: delivery.attempt_count + 1,
        })
        .eq("id", delivery.id);
    } catch (error) {
      await supabase
        .from("webhook_deliveries")
        .update({
          status: "FAILED",
          last_error: error instanceof Error ? error.message : "delivery failed",
          attempt_count: delivery.attempt_count + 1,
        })
        .eq("id", delivery.id);
    }
  }
}
