import { createAdminClient } from "@/lib/supabase/admin";
import { classifyProviderError, delayForAttempt, MAX_ATTEMPTS } from "@/lib/jobs/retry";
import { encryptSecret } from "@/lib/security/crypto";
import { getAutomationSettings } from "@/modules/automation/service";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import { formatBarcode } from "@/modules/india-post/barcode";
import {
  indiaPostBookingArticleType,
  indiaPostMobile,
  indiaPostShapeOfArticle,
} from "@/modules/india-post/endpoints";
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
    else if (queue === "manifest-generation") await generateManifest(supabase, payload);
    else if (queue === "tracking-sync") await syncTracking(supabase, payload);
    else if (queue === "shopify-sync") await shopifySync(supabase, payload);
    else if (queue === "shopify-fulfillment") await shopifyFulfillment();
    else if (queue === "webhook-processing") await deliverWebhooks(supabase, payload);
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

    if (payload.entityType === "shipment" && payload.entityId) {
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

  const weightGrams = Number(shipment.weight_grams) || 100;
  const length = Number(shipment.length_cm) || 0;
  const width = Number(shipment.width_cm) || 0;
  const height = Number(shipment.height_cm) || 0;
  const destPincode = address?.pincode ?? "";
  const officeId = connection.pickup_dropoff_office_id
    ? Number(connection.pickup_dropoff_office_id)
    : 0;

  const result = await provider.bookShipment({
    articles: [
      {
        bulk_customer_id: connection.bulk_customer_id,
        contract_id: contractId,
        barcode_no: barcode,
        pickup_or_dropoff: "dropoff",
        pickup_dropoff_office_id: officeId,
        article_type: indiaPostBookingArticleType(serviceCode),
        physical_weight: weightGrams,
        shape_of_article: indiaPostShapeOfArticle(serviceCode, weightGrams),
        length,
        breadth_diameter: width,
        height,
        sender_name: "Merchant",
        sender_company: "Merchant",
        sender_add_line_1: "Registered pickup",
        sender_city: "NA",
        sender_state: "NA",
        sender_pincode: destPincode,
        receiver_name: address?.name ?? "Customer",
        receiver_company: address?.name ?? "Customer",
        receiver_add_line_1: address?.line1 ?? "",
        receiver_city: address?.city ?? "",
        receiver_state: address?.state ?? "",
        receiver_pincode: destPincode,
        drop_off_pincode: destPincode,
        sender_mobile_no: receiverMobile,
        receiver_mobile_no: receiverMobile,
        alt_address_flag: "FALSE",
        ack: "FALSE",
        reg: "FALSE",
        otp: "FALSE",
      },
    ],
  });

  const valid = result?.valid_articles?.[0];
  if (!valid) {
    const firstError = result?.error_articles?.[0]?.errors?.[0] || "Booking rejected.";
    throw Object.assign(new Error(firstError), { code: "VALIDATION_ERROR" });
  }

  await supabase
    .from("shipments")
    .update({
      status: "BOOKED",
      tracking_number: barcode,
      barcode,
      tariff_amount: valid.calculated_tariff ?? null,
      provider_ref: result.batch_id ?? null,
      booked_at: new Date().toISOString(),
    })
    .eq("id", shipment.id);

  await supabase.from("orders").update({ status: "BOOKED" }).eq("id", shipment.order_id);
  await supabase.from("usage_events").insert({
    organization_id: payload.organizationId,
    metric: "shipments",
    quantity: 1,
  });

  const automation = await loadAutomation(supabase, payload.organizationId);

  const { createBackgroundJob } = await import("@/modules/jobs/service");
  if (automation.autoLabelGeneration) {
    await createBackgroundJob(supabase, {
      organizationId: payload.organizationId,
      jobType: "label-generation",
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
}

async function loadAutomation(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string
): Promise<AutomationSettings> {
  try {
    return await getAutomationSettings(supabase, organizationId);
  } catch {
    return {
      autoShopifySync: true,
      autoShipmentCreation: false,
      autoBooking: false,
      autoLabelGeneration: true,
      autoManifest: false,
      autoTrackingSync: true,
      autoShopifyFulfillment: false,
    };
  }
}

async function generateLabel(supabase: ReturnType<typeof createAdminClient>, payload: JobPayload) {
  const { data: shipment } = await supabase
    .from("shipments")
    .select("*, orders(order_number), customers(name), addresses:shipping_address_id(*)")
    .eq("id", payload.entityId)
    .single();
  if (!shipment?.barcode) {
    throw Object.assign(new Error("Shipment is not booked."), { code: "VALIDATION_ERROR" });
  }

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([420, 595]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const address = shipment.addresses as { name?: string; line1?: string; city?: string; pincode?: string } | null;
  page.drawText("PostBus / India Post Label", { x: 36, y: 540, size: 14, font });
  page.drawText(`Barcode: ${shipment.barcode}`, { x: 36, y: 510, size: 12, font });
  page.drawText(`Order: ${(shipment.orders as { order_number?: string } | null)?.order_number ?? ""}`, {
    x: 36,
    y: 490,
    size: 11,
    font,
  });
  page.drawText(address?.name ?? "", { x: 36, y: 460, size: 12, font });
  page.drawText(address?.line1 ?? "", { x: 36, y: 444, size: 10, font });
  page.drawText(`${address?.city ?? ""} ${address?.pincode ?? ""}`, { x: 36, y: 428, size: 10, font });

  const bytes = await pdf.save();
  const path = `${payload.organizationId}/${shipment.id}.pdf`;
  const upload = await supabase.storage.from("labels").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (upload.error) {
    throw Object.assign(new Error(upload.error.message), { code: "LABEL_GENERATION_FAILED" });
  }
  const { data: signed } = await supabase.storage.from("labels").createSignedUrl(path, 60 * 60 * 24 * 7);
  await supabase.from("labels").insert({
    organization_id: payload.organizationId,
    shipment_id: shipment.id,
    file_path: path,
    file_url: signed?.signedUrl ?? null,
    mime_type: "application/pdf",
    status: "READY",
  });
  await supabase.from("shipments").update({ status: "LABEL_READY" }).eq("id", shipment.id);

  const automation = await loadAutomation(supabase, payload.organizationId);
  const { createBackgroundJob } = await import("@/modules/jobs/service");
  if (automation.autoManifest) {
    await createBackgroundJob(supabase, {
      organizationId: payload.organizationId,
      jobType: "manifest-generation",
      entityType: "shipment",
      entityId: shipment.id,
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
}

async function generateManifest(supabase: ReturnType<typeof createAdminClient>, payload: JobPayload) {
  const { data: shipments } = await supabase
    .from("shipments")
    .select("id, barcode, tracking_number, orders(order_number)")
    .eq("organization_id", payload.organizationId)
    .in("status", ["BOOKED", "LABEL_READY", "MANIFEST_PENDING"]);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("PostBus Manifest", { x: 40, y: 800, size: 16, font });
  (shipments ?? []).forEach((item, index) => {
    const order = item.orders as { order_number?: string } | null;
    page.drawText(
      `${index + 1}. ${item.barcode ?? ""}  ${order?.order_number ?? ""}`,
      { x: 40, y: 760 - index * 16, size: 10, font }
    );
  });
  const bytes = await pdf.save();
  const path = `${payload.organizationId}/manifest-${payload.jobId}.pdf`;
  await supabase.storage.from("manifests").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  const { data: signed } = await supabase.storage
    .from("manifests")
    .createSignedUrl(path, 60 * 60 * 24 * 7);

  const { data: manifest } = await supabase
    .from("manifests")
    .insert({
      organization_id: payload.organizationId,
      name: `Manifest ${new Date().toISOString().slice(0, 10)}`,
      status: "READY",
      file_path: path,
      file_url: signed?.signedUrl ?? null,
      shipment_count: shipments?.length ?? 0,
    })
    .select()
    .single();

  if (manifest && shipments?.length) {
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
    .select("id, barcode")
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
    const delivered = article.del_status?.del_status === "delivered";
    if (delivered) {
      await supabase.from("shipments").update({ status: "DELIVERED" }).eq("id", shipment.id);
    }
  }
}

async function shopifySync(supabase: ReturnType<typeof createAdminClient>, payload: JobPayload) {
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

async function shopifyFulfillment() {
  // Requires a connected store; skip silently if fulfillment API is not configured.
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
