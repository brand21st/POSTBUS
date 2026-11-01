import { createAdminClient } from "@/lib/supabase/admin";
import { classifyProviderError, delayForAttempt, MAX_ATTEMPTS } from "@/lib/jobs/retry";
import { bookingFailureShipmentUpdate, isAmbiguousCeptOutcome, shouldApplyBookingFailureUpdate } from "@/modules/india-post/booking-failure-state";
import { logError, logInfo } from "@/lib/logger";
import {
  AUTOMATION_DEFAULTS,
  getAutomationSettings,
  isAutoShopifySyncEnabled,
  isAutoWooCommerceSyncEnabled,
  mapAutomationSettings,
} from "@/modules/automation/service";
import { TRACKING_POLL_STATUSES } from "@/modules/india-post/apply-tracking";
import {
  readLookbackState,
  runOrganizationEventDownloadSync,
  shouldRunHistoricalLookback,
} from "@/modules/india-post/event-download-sync";
import { indiaPostEventCustomerId } from "@/modules/india-post/event-download";
import { indiaPostEventDownloadLookbackIntervalMs } from "@/modules/india-post/spec";
import { tagTrackingLoginAuthFailure } from "@/modules/india-post/login-auth";
import {
  emptyTrackingJobProgress,
  trackingFailureStampsAttemptClock,
  trackingLogMessage,
  type TrackingJobProgress,
} from "@/modules/india-post/tracking-outcomes";
import { ensurePersistedIndiaPostSession } from "@/modules/india-post/session";
import {
  enqueueOrgTrackingSyncIfIdle,
  trackingSyncMinIntervalMs,
} from "@/modules/india-post/tracking-sync";
import { runIndiaPostBooking } from "@/modules/india-post/booking-run";
import { assertIndiaPostBulkPostAllowed } from "@/modules/india-post/bulk-run";
import { BULK_BATCH_JOB_ENTITY, loadBulkBatchById, loadBulkBatchByJobId } from "@/modules/india-post/bulk-store";
import { isBulkBatchSuperseded, runIndiaPostBulkWorkerAttempt } from "@/modules/india-post/bulk-worker";
import { fetchOfficialIndiaPostLabelPdf } from "@/modules/labels/official-fetch";
import { persistPackingSlip } from "@/modules/labels/packing-fetch";
import { persistLabelPdf } from "@/modules/labels/persist";
import { findReadyIndiaPostLabel } from "@/modules/labels/ready";
import { runPool } from "@/lib/async/pool";
import { inlineLabelTimeoutMs } from "@/modules/india-post/http";
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
    else if (queue === "bulk-excel-import") {
      const { materializeBulkExcelImport } = await import("@/modules/india-post/bulk-excel-import");
      if (!payload.entityId) {
        throw Object.assign(new Error("Bulk Excel import id is missing."), { code: "VALIDATION_ERROR" });
      }
      await materializeBulkExcelImport(supabase, payload.organizationId, payload.entityId, jobId);
    }
    else if (queue === "label-generation") await generateLabel(supabase, payload);
    else if (queue === "invoice-generation") await generateInvoice(supabase, payload);
    else if (queue === "sales-invoice-issue") await issueSalesInvoiceJob(supabase, payload);
    else if (queue === "manifest-generation") await generateManifest(supabase, payload);
    else if (queue === "tracking-sync") await syncTracking(supabase, payload);
    else if (queue === "shopify-sync") await shopifySync(supabase, payload);
    else if (queue === "woocommerce-sync") await wooCommerceSync(supabase, payload);
    else if (queue === "woocommerce-tracking") await wooCommerceTracking(supabase, payload);
    else if (queue === "shopify-fulfillment") await shopifyFulfillment(supabase, payload);
    else if (queue === "webhook-processing") await deliverWebhooks(supabase, payload);
    else if (queue === "support-ingest") {
      const { data: job } = await supabase
        .from("background_jobs")
        .select("progress")
        .eq("id", jobId)
        .maybeSingle();
      const { processSupportIngestJob } = await import("@/modules/support/ingest");
      await processSupportIngestJob(
        supabase,
        payload.organizationId,
        (job?.progress ?? {}) as Record<string, unknown>
      );
    }
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
      const { sendVachatNotice, sendVachatSessionText, vachatEventFromJobProgress, vachatIdsFromJob } = await import(
        "@/modules/vachat/send"
      );
      const { vachatNotifyJobKind } = await import("@/modules/vachat/notify-job");
      const { data: job } = await supabase
        .from("background_jobs")
        .select("progress")
        .eq("id", jobId)
        .maybeSingle();
      const progress = (job?.progress ?? {}) as {
        kind?: string;
        source?: string;
        to?: string;
        text?: string;
        supportMessageId?: string;
        templateName?: string;
        language?: string;
        variables?: string[];
        userId?: string;
        extras?: { interactive_payload?: Record<string, unknown>; image_url?: string };
      };
      const jobKind = vachatNotifyJobKind(progress);
      if (jobKind === "support") {
        const { deliverQueuedSupportMessage } = await import("@/modules/support/send");
        await deliverQueuedSupportMessage(supabase, payload.organizationId, progress);
      } else if (jobKind === "signup_welcome") {
        const { deliverSignupWelcome } = await import("@/modules/vachat/signup-welcome");
        await deliverSignupWelcome(supabase, payload.organizationId, progress);
      } else if (jobKind === "session_text") {
        await sendVachatSessionText(String(progress.to ?? ""), String(progress.text ?? ""));
      } else {
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
    }
    else if (queue === "ai-image") {
      const { data: job } = await supabase
        .from("background_jobs")
        .select("progress, entity_id")
        .eq("id", jobId)
        .maybeSingle();
      const aiImageJobId = String(
        (job?.progress as { aiImageJobId?: string } | null)?.aiImageJobId || job?.entity_id || payload.entityId || ""
      );
      if (!aiImageJobId) {
        throw Object.assign(new Error("AI image job id is missing."), { code: "VALIDATION_ERROR" });
      }
      const { processAiImageJob } = await import("@/modules/ai-image/process");
      await processAiImageJob(supabase, payload.organizationId, aiImageJobId);
    }
    else if (queue === "gst-draft") {
      const { data: job } = await supabase.from("background_jobs").select("progress").eq("id", jobId).maybeSingle();
      const progress = (job?.progress ?? {}) as { type?: "GSTR1" | "GSTR3B"; month?: number; year?: number };
      if (!progress.type || !progress.month || !progress.year) {
        throw Object.assign(new Error("GST draft period is missing."), { code: "VALIDATION_ERROR" });
      }
      const { prepareGstReturn } = await import("@/modules/ai-accountant/gst-service");
      await prepareGstReturn(supabase, payload.organizationId, {
        type: progress.type,
        month: progress.month,
        year: progress.year,
      });
    }
    else if (queue === "accounting-rebuild") {
      const { data: job } = await supabase.from("background_jobs").select("progress").eq("id", jobId).maybeSingle();
      const progress = (job?.progress ?? {}) as { from?: string; to?: string };
      const { syncLedger } = await import("@/modules/ai-accountant/ledger/post");
      const { fiscalYearPeriod, istDate, isIsoDate } = await import("@/modules/ai-accountant/period");
      const today = istDate();
      await syncLedger(supabase, payload.organizationId, {
        from: isIsoDate(progress.from) ? progress.from : fiscalYearPeriod(today).from,
        to: isIsoDate(progress.to) ? progress.to : today,
      });
    }
    else if (queue === "cod-report-extract") {
      // COD ingest currently runs inline; this lane keeps PDF extraction off the booking worker.
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
    const classified = classifyProviderError(error);
    logError("job.failed", {
      ...timing,
      durationMs: Date.now() - started,
      status: "failed",
      message: classified.message,
      errorCode: classified.code,
      httpStatus: classified.httpStatus,
      retryable: classified.retryable,
    });
    const { data: job } = await supabase
      .from("background_jobs")
      .select("attempt_count, max_attempts")
      .eq("id", jobId)
      .single();
    const attempt = (job?.attempt_count ?? 0) + 1;
    const postSubmitUncertain = queue === "shipment-booking" && isAmbiguousCeptOutcome(classified);
    const retryable =
      classified.retryable && !postSubmitUncertain && attempt < (job?.max_attempts ?? MAX_ATTEMPTS);
    const retryAfterMs = Number((error as { retryAfterMs?: number })?.retryAfterMs);
    const retryDelayMs = retryable
      ? Number.isFinite(retryAfterMs) && retryAfterMs >= 0
        ? retryAfterMs
        : delayForAttempt(attempt)
      : 0;
    logInfo("job.retry_decision", {
      ...timing,
      attempt,
      maxAttempts: job?.max_attempts ?? MAX_ATTEMPTS,
      errorCode: classified.code,
      httpStatus: classified.httpStatus,
      retryable,
      retryDelayMs,
    });
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
        next_attempt_at: retryable ? new Date(Date.now() + retryDelayMs).toISOString() : null,
      })
      .eq("id", jobId);

    const failureShipmentIds = [
      ...new Set(
        [
          ...((error as { shipmentIds?: string[] }).shipmentIds ?? []),
          ...(payload.shipmentIds ?? []),
          payload.entityType === "shipment" ? payload.entityId : undefined,
        ].filter((id): id is string => Boolean(id))
      ),
    ];
    if (shouldApplyBookingFailureUpdate(queue) && failureShipmentIds.length) {
    const shipmentPatch = bookingFailureShipmentUpdate(classified, retryable);
    await supabase
      .from("shipments")
      .update({
        status: shipmentPatch.status,
        last_error: classified.message,
        last_error_code: classified.code,
      })
      .eq("organization_id", payload.organizationId)
      .in("id", failureShipmentIds)
      .is("booked_at", null)
      .in("status", [...shipmentPatch.allowedStatuses]);
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
      .eq("organization_id", payload.organizationId)
      .in("id", shipmentIds)
      .is("booked_at", null);
    throw Object.assign(new Error(message), { code: "VALIDATION_ERROR" });
  }

  const bookingStarted = Date.now();
  assertIndiaPostBulkPostAllowed(shipmentIds.length);
  // New bulk jobs are keyed on their batch, so a job claimed before job_id is linked still finds it.
  // Older jobs were keyed on a member shipment and are found by job_id.
  const bulkBatch =
    shipmentIds.length < 2
      ? null
      : payload.entityType === BULK_BATCH_JOB_ENTITY && payload.entityId
        ? await loadBulkBatchById(supabase, payload.organizationId, payload.entityId)
        : payload.jobId
          ? await loadBulkBatchByJobId(supabase, payload.jobId)
          : null;
  if (shipmentIds.length > 1 && !bulkBatch) {
    throw Object.assign(new Error("Multi-article booking requires a durable bulk batch."), { code: "VALIDATION_ERROR" });
  }
  let outcome: Awaited<ReturnType<typeof runIndiaPostBulkWorkerAttempt>>;
  try {
    outcome = await runIndiaPostBulkWorkerAttempt({
      supabase,
      organizationId: payload.organizationId,
      shipmentIds,
      bulkBatch,
      post: () =>
        runIndiaPostBooking(supabase, {
          organizationId: payload.organizationId,
          shipmentIds,
          jobId: payload.jobId,
        }),
    });
  } catch (error) {
    if (!isBulkBatchSuperseded(error)) throw error;
    // Nothing was posted by this job; the owning job reports the shipments.
    logInfo("booking.bulk_superseded", {
      organizationId: payload.organizationId,
      jobId: payload.jobId,
      batchId: bulkBatch?.id,
      batchStatus: bulkBatch?.status,
    });
    return;
  }
  logInfo("booking.completed", {
    organizationId: payload.organizationId,
    jobId: payload.jobId,
    jobType: "shipment-booking",
    booked: outcome.bookedIds.length,
    failed: outcome.failedIds.length,
    recovery: outcome.recoveryIds?.length ?? 0,
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
      await enqueueOrgTrackingSyncIfIdle(supabase, payload.organizationId);
    }
  });

  if (automation.autoWooCommerceTracking && outcome.bookedIds.length) {
    const { data: bookedShipments } = await supabase
      .from("shipments")
      .select("order_id")
      .eq("organization_id", payload.organizationId)
      .in("id", outcome.bookedIds);
    const orderIds = [...new Set((bookedShipments ?? []).map((row) => row.order_id).filter(Boolean))];
    if (orderIds.length) {
      const { data: wooOrders } = await supabase
        .from("orders")
        .select("id")
        .eq("organization_id", payload.organizationId)
        .eq("source", "WOOCOMMERCE")
        .in("id", orderIds);
      for (const order of wooOrders ?? []) {
        await createBackgroundJob(supabase, {
          organizationId: payload.organizationId,
          jobType: "woocommerce-tracking",
          entityType: "order",
          entityId: order.id,
          progress: { stage: "booked" },
        });
      }
    }
  }
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

async function issueSalesInvoiceJob(supabase: ReturnType<typeof createAdminClient>, payload: JobPayload) {
  if (!payload.entityId) {
    throw Object.assign(new Error("Order is missing."), { code: "VALIDATION_ERROR" });
  }
  const { runAutoSalesInvoice } = await import("@/modules/sales-invoices/auto");
  await runAutoSalesInvoice(supabase, payload.organizationId, payload.entityId, payload.userId);
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
  const { assignToDraft, sweepEligible } = await import("@/modules/manifests/service");
  // Label jobs enqueue one shipment; "Add ready shipments" and legacy jobs sweep the workspace.
  const { added } =
    payload.entityType === "shipment" && payload.entityId
      ? await assignToDraft(supabase, payload.organizationId, [payload.entityId])
      : await sweepEligible(supabase, payload.organizationId, { userId: payload.userId ?? null });
  if (!added.length) return;

  const automation = await loadAutomation(supabase, payload.organizationId);
  if (automation.autoShopifyFulfillment) {
    const { createBackgroundJob } = await import("@/modules/jobs/service");
    // Only newly manifested shipments: re-runs must not fan out fulfillment again.
    for (const shipmentId of added) {
      await createBackgroundJob(supabase, {
        organizationId: payload.organizationId,
        jobType: "shopify-fulfillment",
        entityType: "shipment",
        entityId: shipmentId,
      });
    }
  }
}

async function writeTrackingJobProgress(
  supabase: ReturnType<typeof createAdminClient>,
  payload: JobPayload,
  progress: TrackingJobProgress
) {
  if (!payload.jobId) return;
  await supabase
    .from("background_jobs")
    .update({ progress })
    .eq("id", payload.jobId)
    .eq("organization_id", payload.organizationId);
}

async function stampTrackingAttemptClock(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
  shipmentIds: string[]
) {
  if (!shipmentIds.length) return;
  await supabase
    .from("shipments")
    .update({ last_tracked_at: new Date().toISOString() })
    .in("id", shipmentIds)
    .eq("organization_id", organizationId);
}

async function syncTracking(supabase: ReturnType<typeof createAdminClient>, payload: JobPayload) {
  const started = Date.now();
  const progress = emptyTrackingJobProgress();
  const automation = await loadAutomation(supabase, payload.organizationId);
  // TNT01/TNT02 run for every org; the Event Download allowlist only gates the 403 fallback inside the sync.
  if (!automation.autoTrackingSync) {
    progress.noWork = true;
    progress.providerSyncOutcome = "NO_WORK";
    await writeTrackingJobProgress(supabase, payload, progress);
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
  try {
    const { count } = await supabase
      .from("shipments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", payload.organizationId)
      .not("barcode", "is", null)
      .in("status", [...TRACKING_POLL_STATUSES])
      .or("operational_status.is.null,operational_status.neq.RTO_DELIVERED");
    progress.awbsEligible = count ?? 0;
    if (!progress.awbsEligible) {
      progress.noWork = true;
      progress.providerSyncOutcome = "NO_WORK";
      await writeTrackingJobProgress(supabase, payload, progress);
      return;
    }

    const provider = await ensurePersistedIndiaPostSession(supabase, connection);
    const overlap = await runOrganizationEventDownloadSync(supabase, {
      organizationId: payload.organizationId,
      provider,
      bulkCustomerId: connection.bulk_customer_id,
      mode: "overlap",
      source: "event_download",
      cooldownMs: trackingSyncMinIntervalMs(),
    });
    progress.awbsAttempted = overlap.articlesReceived;
    progress.awbsMatched = overlap.articlesMatched;
    progress.awbsWithEvents = overlap.eventsInserted > 0 ? overlap.articlesMatched : 0;
    progress.eventsInserted = overlap.eventsInserted;
    progress.eventsDuplicate = overlap.eventsDuplicate;
    progress.batchesAttempted = overlap.datesFetched.length;
    progress.batchesSucceeded = overlap.skippedFetch ? 0 : overlap.datesFetched.length;
    progress.providerSyncOutcome = overlap.eventsInserted ? "SUCCEEDED" : "EMPTY_ACCEPTED";
    (progress as TrackingJobProgress & { provider?: string; datesFetched?: string[] }).provider = overlap.trackingSource;
    (progress as TrackingJobProgress & { provider?: string; datesFetched?: string[] }).datesFetched = overlap.datesFetched;

    const lookbackCustId = indiaPostEventCustomerId(connection.bulk_customer_id);
    const lookbackState = lookbackCustId
      ? await readLookbackState(supabase, payload.organizationId, lookbackCustId)
      : null;
    if (shouldRunHistoricalLookback(lookbackState?.last_lookback_success_at ?? null)) {
      const lookback = await runOrganizationEventDownloadSync(supabase, {
        organizationId: payload.organizationId,
        provider,
        bulkCustomerId: connection.bulk_customer_id,
        mode: "lookback",
        source: "event_download",
        cooldownMs: indiaPostEventDownloadLookbackIntervalMs(),
      });
      progress.eventsInserted += lookback.eventsInserted;
      progress.eventsDuplicate += lookback.eventsDuplicate;
      progress.awbsMatched += lookback.articlesMatched;
    }

    await writeTrackingJobProgress(supabase, payload, progress);
    logInfo("india_post.tracking.sync_ok", {
      organizationId: payload.organizationId,
      jobId: payload.jobId,
      durationMs: Date.now() - started,
      provider: overlap.trackingSource,
      providerSyncOutcome: progress.providerSyncOutcome,
      awbsMatched: progress.awbsMatched,
      eventsInserted: progress.eventsInserted,
    });
  } catch (error) {
    const tagged = tagTrackingLoginAuthFailure(error);
    const taggedError = tagged as { code?: string; status?: number };
    if (trackingFailureStampsAttemptClock(tagged)) {
      progress.awbsRejected += 1;
    }
    await writeTrackingJobProgress(supabase, payload, progress);
    logError("india_post.tracking.sync_fail", {
      organizationId: payload.organizationId,
      jobId: payload.jobId,
      durationMs: Date.now() - started,
      errorCode: taggedError.code,
      httpStatus: taggedError.status,
      message: trackingLogMessage(tagged),
    });
    throw tagged;
  }
}

async function wooCommerceSync(supabase: ReturnType<typeof createAdminClient>, payload: JobPayload) {
  const { data: job } = await supabase
    .from("background_jobs")
    .select("progress")
    .eq("id", payload.jobId)
    .maybeSingle();
  const progress =
    job?.progress && typeof job.progress === "object"
      ? (job.progress as {
          mode?: string;
          force?: boolean;
          page?: number;
          imported?: number;
          updated?: number;
          skipped?: number;
          topic?: string;
          orderId?: string;
          deliveryId?: string;
        })
      : {};
  if (progress.mode === "webhook") {
    const { processWooWebhookJob } = await import("@/modules/woocommerce/webhooks");
    await processWooWebhookJob(supabase, {
      organizationId: payload.organizationId,
      connectionId: payload.entityId || "",
      topic: progress.topic || "",
      orderId: progress.orderId || "",
      deliveryId: progress.deliveryId,
    });
    return;
  }
  if (!progress.force && !(await isAutoWooCommerceSyncEnabled(supabase, payload.organizationId))) return;
  const { credentialsFromConnection, loadWooConnection } = await import("@/modules/woocommerce/connect");
  const { syncWooCommercePage } = await import("@/modules/woocommerce/orders");
  const { enqueueWooCommerceSync } = await import("@/modules/woocommerce/sync-job");
  const connection = await loadWooConnection(supabase, payload.organizationId);
  const credentials = credentialsFromConnection(connection);
  if (!connection || connection.status !== "CONNECTED" || !credentials) {
    throw Object.assign(new Error("WooCommerce is not connected."), { code: "PERMANENT_AUTH_ERROR" });
  }
  let result: Awaited<ReturnType<typeof syncWooCommercePage>>;
  try {
    result = await syncWooCommercePage(supabase, {
      connection,
      credentials,
      userId: payload.userId,
      page: progress.page ?? 1,
      force: progress.force,
    });
  } catch (error) {
    const { redactWooText } = await import("@/modules/woocommerce/sync-window");
    const message = redactWooText(error instanceof Error ? error.message : "WooCommerce sync failed.");
    logError("woocommerce.sync_failed", {
      organizationId: payload.organizationId,
      jobId: payload.jobId,
      page: progress.page ?? 1,
      force: Boolean(progress.force),
      message,
    });
    await supabase
      .from("woocommerce_connections")
      .update({ last_error: message.slice(0, 500) })
      .eq("id", connection.id);
    throw error;
  }
  const imported = (progress.imported ?? 0) + result.imported;
  const updated = (progress.updated ?? 0) + result.updated;
  const skipped = (progress.skipped ?? 0) + result.skipped;
  await supabase
    .from("background_jobs")
    .update({ progress: { ...progress, imported, updated, skipped, hasMore: result.hasMore, page: result.nextPage } })
    .eq("id", payload.jobId);
  await supabase
    .from("woocommerce_connections")
    .update({
      last_sync_at: new Date().toISOString(),
      last_error: null,
      ...(result.hasMore ? {} : { last_successful_sync_at: new Date().toISOString() }),
    })
    .eq("id", connection.id);
  if (result.hasMore && result.nextPage) {
    await enqueueWooCommerceSync(supabase, {
      organizationId: payload.organizationId,
      userId: payload.userId,
      // Keep the same window: a scheduled incremental run must not widen to the full import on page 2.
      force: Boolean(progress.force),
      page: result.nextPage,
      imported,
      updated,
      skipped,
    });
  }
}

async function wooCommerceTracking(supabase: ReturnType<typeof createAdminClient>, payload: JobPayload) {
  if (!payload.entityId) return;
  const { data: job } = await supabase.from("background_jobs").select("progress").eq("id", payload.jobId).maybeSingle();
  const stage =
    job?.progress && typeof job.progress === "object" ? (job.progress as { stage?: string }).stage : undefined;
  const { syncWooCommerceTracking } = await import("@/modules/woocommerce/tracking");
  await syncWooCommerceTracking(supabase, {
    organizationId: payload.organizationId,
    orderId: payload.entityId,
    stage,
  });
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
          since?: string | null;
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
      since: progress.since ?? null,
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
        since: result.since ?? progress.since ?? null,
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
  const { runWebhookProcessing } = await import("@/modules/webhooks/deliver");
  await runWebhookProcessing(supabase, payload.organizationId);
}
