import { createAdminClient } from "@/lib/supabase/admin";
import { classifyProviderError, delayForAttempt, MAX_ATTEMPTS } from "@/lib/jobs/retry";
import { logError, logInfo } from "@/lib/logger";
import {
  AUTOMATION_DEFAULTS,
  getAutomationSettings,
  isAutoShopifySyncEnabled,
  mapAutomationSettings,
} from "@/modules/automation/service";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import {
  ingestBulkTrackingArticle,
  snapshotFromShipmentRow,
  TRACKING_POLL_STATUSES,
  type BulkTrackingArticle,
} from "@/modules/india-post/apply-tracking";
import { enqueueTrackingStageSideEffects } from "@/modules/india-post/tracking-effects";
import { runIndiaPostBooking } from "@/modules/india-post/booking-run";
import { fetchOfficialIndiaPostLabelPdf } from "@/modules/labels/official-fetch";
import { persistPackingSlip } from "@/modules/labels/packing-fetch";
import { persistLabelPdf } from "@/modules/labels/persist";
import { findReadyIndiaPostLabel } from "@/modules/labels/ready";
import { runPool } from "@/lib/async/pool";
import { inlineLabelTimeoutMs } from "@/modules/india-post/http";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { JobPayload } from "@/lib/queue/queues";
import type { AutomationSettings } from "@/types/api";

export async function processJob(queue: string, payload: JobPayload) {
  const supabase = createAdminClient();
  const jobId = payload.jobId;
  const started = Date.now();
  const timing = {
    jobId,
    jobType: queue,
    organizationId: payload.organizationId,
    entityId: payload.entityId,
    shipmentId: payload.entityType === "shipment" ? payload.entityId : undefined,
    attempt: payload.attempt,
    queueWaitMs: payload.queueWaitMs,
  };
  logInfo("job.started", timing);

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
    else if (queue === "vachat-notify") {
      const { sendVachatNotice, vachatEventFromJobProgress, vachatIdsFromJob } = await import("@/modules/vachat/send");
      const { data: job } = await supabase
        .from("background_jobs")
        .select("progress")
        .eq("id", jobId)
        .maybeSingle();
      const ids = vachatIdsFromJob(job?.progress, payload.entityId);
      if (!ids.shipmentId && !ids.orderId) {
        throw Object.assign(new Error("Order or shipment id is missing for Vachat notify."), {
          code: "VALIDATION_ERROR",
        });
      }
      await sendVachatNotice(
        supabase,
        payload.organizationId,
        vachatEventFromJobProgress(job?.progress),
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
    logInfo("job.completed", { ...timing, durationMs: Date.now() - started, status: "ok" });
  } catch (error) {
    logError("job.failed", {
      ...timing,
      durationMs: Date.now() - started,
      status: "failed",
      message: error instanceof Error ? error.message : "job failed",
    });
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

    if (
      queue !== "invoice-generation" &&
      queue !== "label-generation" &&
      queue !== "wati-notify" &&
      queue !== "vachat-notify" &&
      payload.entityType === "shipment" &&
      payload.entityId
    ) {
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
  const shipmentIds = payload.shipmentIds?.length
    ? payload.shipmentIds
    : payload.entityId
      ? [payload.entityId]
      : [];
  if (!shipmentIds.length) {
    throw Object.assign(new Error("Shipment is missing."), { code: "VALIDATION_ERROR" });
  }

  try {
    const { checkQuota } = await import("@/modules/billing/usage");
    await checkQuota(supabase, payload.organizationId, shipmentIds.length);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Billing quota exceeded.";
    await supabase
      .from("shipments")
      .update({ status: "FAILED", last_error: message, last_error_code: "BILLING_LIMIT" })
      .in("id", shipmentIds);
    throw Object.assign(new Error(message), { code: "VALIDATION_ERROR" });
  }

  const bookingStarted = Date.now();
  const outcome = await runIndiaPostBooking(supabase, {
    organizationId: payload.organizationId,
    shipmentIds,
  });
  logInfo("booking.completed", {
    organizationId: payload.organizationId,
    jobId: payload.jobId,
    jobType: "shipment-booking",
    booked: outcome.bookedIds.length,
    failed: outcome.failedIds.length,
    durationMs: Date.now() - bookingStarted,
  });

  const automation = await loadAutomation(supabase, payload.organizationId);
  const { createBackgroundJob } = await import("@/modules/jobs/service");
  const { consumeQuota } = await import("@/modules/billing/usage");

  if (outcome.bookedIds.length) {
    await supabase
      .from("shipments")
      .update({ status: "LABEL_PENDING" })
      .eq("organization_id", payload.organizationId)
      .in("id", outcome.bookedIds)
      .eq("status", "BOOKED");
  }

  if (outcome.bookedIds.length) {
    try {
      await consumeQuota(supabase, payload.organizationId, outcome.bookedIds.length);
    } catch (error) {
      logError("BILLING_QUOTA_CONSUME_FAILED", {
        organizationId: payload.organizationId,
        quantity: outcome.bookedIds.length,
        message: error instanceof Error ? error.message : "unknown",
      });
      await supabase.from("usage_events").insert({
        organization_id: payload.organizationId,
        metric: "shipments",
        quantity: outcome.bookedIds.length,
      });
    }
  }

  await runPool(outcome.bookedIds, 4, async (shipmentId) => {
    const { data: shipment } = await supabase
      .from("shipments")
      .select("id, order_id")
      .eq("id", shipmentId)
      .maybeSingle();
    if (!shipment) return;
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
    const labelMs = inlineLabelTimeoutMs(bookingStarted);
    if (!labelMs) {
      await createBackgroundJob(supabase, {
        organizationId: payload.organizationId,
        jobType: "label-generation",
        entityType: "shipment",
        entityId: shipment.id,
      });
    } else {
      try {
        await generateLabel(
          supabase,
          {
            organizationId: payload.organizationId,
            jobId: payload.jobId,
            entityType: "shipment",
            entityId: shipment.id,
            userId: payload.userId,
          },
          labelMs
        );
      } catch (error) {
        logError("LABEL_INLINE_FAILED", {
          organizationId: payload.organizationId,
          shipmentId: shipment.id,
          message: error instanceof Error ? error.message : "unknown",
        });
        await createBackgroundJob(supabase, {
          organizationId: payload.organizationId,
          jobType: "label-generation",
          entityType: "shipment",
          entityId: shipment.id,
        });
      }
    }
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

async function enqueueBookedWhatsAppAfterLabel(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
  shipmentId: string
) {
  const { data: shipment } = await supabase
    .from("shipments")
    .select("id, order_id")
    .eq("id", shipmentId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!shipment) return;
  try {
    const { enqueueWatiNotify } = await import("@/modules/wati/send");
    await enqueueWatiNotify(supabase, organizationId, "booked", {
      shipmentId: shipment.id,
      orderId: shipment.order_id,
    });
  } catch {
    // WhatsApp is optional; the label should still be stored.
  }
  try {
    const { enqueueVachatNotify } = await import("@/modules/vachat/send");
    await enqueueVachatNotify(supabase, organizationId, "booked", {
      shipmentId: shipment.id,
      orderId: shipment.order_id,
    });
  } catch {
    // Vachat is optional; the label should still be stored.
  }
  try {
    const { scheduleMerchantKnowledgeSync } = await import("@/modules/vachat/knowledge");
    scheduleMerchantKnowledgeSync(supabase, organizationId);
  } catch {
    // VaChat knowledge is optional; the label should still be stored.
  }
}

async function generateInvoice(supabase: ReturnType<typeof createAdminClient>, payload: JobPayload) {
  if (!payload.entityId) {
    throw Object.assign(new Error("Shipment is missing."), { code: "VALIDATION_ERROR" });
  }
  const { generateShippingInvoice } = await import("@/modules/invoices/service");
  await generateShippingInvoice(supabase, payload.organizationId, payload.entityId);
}

async function generateLabel(
  supabase: ReturnType<typeof createAdminClient>,
  payload: JobPayload,
  timeoutMs?: number
) {
  if (!payload.entityId) {
    throw Object.assign(new Error("Shipment is missing."), { code: "VALIDATION_ERROR" });
  }
  const existing = await findReadyIndiaPostLabel(supabase, payload.organizationId, payload.entityId);
  if (existing) {
    await supabase.from("shipments").update({ status: "LABEL_READY" }).eq("id", payload.entityId);
    try {
      await persistPackingSlip(supabase, payload.organizationId, payload.entityId);
    } catch (error) {
      logError("PACKING_LABEL_FAILED", {
        organizationId: payload.organizationId,
        shipmentId: payload.entityId,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
    await enqueueBookedWhatsAppAfterLabel(supabase, payload.organizationId, payload.entityId);
    return;
  }

  const officialPdf = await fetchOfficialIndiaPostLabelPdf(
    supabase,
    payload.organizationId,
    payload.entityId,
    timeoutMs ? { timeoutMs } : undefined
  );
  const official = await persistLabelPdf(supabase, {
    organizationId: payload.organizationId,
    shipmentId: officialPdf.shipmentId,
    kind: "INDIA_POST",
    bytes: officialPdf.pdf,
  });
  await supabase.from("shipments").update({ status: "LABEL_READY" }).eq("id", officialPdf.shipmentId);

  try {
    await persistPackingSlip(supabase, payload.organizationId, officialPdf.shipmentId);
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
  await enqueueBookedWhatsAppAfterLabel(supabase, payload.organizationId, officialPdf.shipmentId);
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
    .in("status", ["BOOKED", "LABEL_PENDING", "LABEL_READY", "MANIFEST_PENDING", "MANIFEST_READY"])
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
    .select(
      "id, barcode, status, order_id, operational_status, last_event_at, ndr_attempt_count, rto_initiated_at"
    )
    .eq("organization_id", payload.organizationId)
    .not("barcode", "is", null)
    .in("status", [...TRACKING_POLL_STATUSES])
    .or("operational_status.is.null,operational_status.neq.RTO_DELIVERED");
  const barcodes = (shipments ?? []).map((item) => item.barcode).filter(Boolean) as string[];
  if (!barcodes.length) return;
  const provider = indiaPostFromRow(connection);
  const result = (await provider.trackShipment(barcodes)) as {
    data?: BulkTrackingArticle[];
  };
  for (const article of result.data ?? []) {
    const barcode = article.booking_details?.article_number;
    const shipment = shipments?.find((item) => item.barcode === barcode);
    if (!shipment) continue;
    const ingested = await ingestBulkTrackingArticle(supabase, {
      organizationId: payload.organizationId,
      shipment: snapshotFromShipmentRow(shipment, payload.organizationId),
      article,
    });
    if (ingested.whatsappEvents.length || ingested.orderStatus) {
      await enqueueTrackingStageSideEffects(supabase, {
        organizationId: payload.organizationId,
        shipmentId: shipment.id,
        orderId: shipment.order_id,
        orderStatus: ingested.orderStatus,
        events: ingested.whatsappEvents,
      });
    }
  }
}

async function shopifySync(supabase: ReturnType<typeof createAdminClient>, payload: JobPayload) {
  const { data: job } = await supabase
    .from("background_jobs")
    .select("progress")
    .eq("id", payload.jobId)
    .maybeSingle();
  const progress =
    job?.progress && typeof job.progress === "object"
      ? (job.progress as {
          force?: boolean;
          pageInfo?: string | null;
          imported?: number;
          updated?: number;
          skipped?: number;
        })
      : {};
  const force = progress.force === true;
  if (!force && !(await isAutoShopifySyncEnabled(supabase, payload.organizationId))) {
    return;
  }

  const { syncUnfulfilledShopifyOrders } = await import("@/modules/shopify/orders");
  const { enqueueShopifyOrderSync } = await import("@/modules/shopify/sync-job");
  try {
    const result = await syncUnfulfilledShopifyOrders(supabase, {
      organizationId: payload.organizationId,
      userId: payload.userId,
      pageInfo: progress.pageInfo ?? null,
    });
    if (!result.connected) {
      throw Object.assign(new Error("Shopify is not connected."), { code: "PERMANENT_AUTH_ERROR" });
    }
    const imported = (progress.imported ?? 0) + result.imported;
    const updated = (progress.updated ?? 0) + result.updated;
    const skipped = (progress.skipped ?? 0) + result.skipped;
    await supabase
      .from("background_jobs")
      .update({
        progress: {
          ...progress,
          imported,
          updated,
          skipped,
          hasMore: result.hasMore,
          pageInfo: result.nextPageInfo ?? null,
        },
      })
      .eq("id", payload.jobId);
    if (result.hasMore && result.nextPageInfo) {
      await enqueueShopifyOrderSync(supabase, {
        organizationId: payload.organizationId,
        userId: payload.userId,
        force: true,
        pageInfo: result.nextPageInfo,
        imported,
        updated,
        skipped,
      });
    }
  } catch (error) {
    const httpError = error as {
      message?: string;
      shopifyPageInfo?: string | null;
      imported?: number;
      updated?: number;
      skipped?: number;
    };
    logError("shopify.sync_job_failed", {
      organizationId: payload.organizationId,
      jobId: payload.jobId,
      message: httpError.message ?? "Shopify sync failed",
    });
    await supabase
      .from("shopify_connections")
      .update({ last_error: httpError.message ?? "Shopify sync failed" })
      .eq("organization_id", payload.organizationId);
    await supabase
      .from("background_jobs")
      .update({
        progress: {
          ...progress,
          pageInfo: httpError.shopifyPageInfo ?? progress.pageInfo ?? null,
          imported: (progress.imported ?? 0) + (httpError.imported ?? 0),
          updated: (progress.updated ?? 0) + (httpError.updated ?? 0),
          skipped: (progress.skipped ?? 0) + (httpError.skipped ?? 0),
        },
      })
      .eq("id", payload.jobId);
    throw error;
  }
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
