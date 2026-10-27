import { NextRequest, NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { hasPermission } from "@/lib/permissions/rbac";
import { assertBrowserOrigin } from "@/lib/security/origin";
import {
  parseBulkPrintIds,
  prepareBulkShippingSlips,
  printBulkShippingSlips,
} from "@/modules/labels/bulk-slip-print";
import {
  claimManualPrintKey,
  printRequestFingerprint,
  releaseManualPrintKey,
  requirePrintIdempotencyKey,
  storeManualPrintKey,
} from "@/modules/print/manual-idempotency";
import { orIlike } from "@/lib/api/filters";
import { indiaPostDisplayShipmentStatus } from "@/modules/india-post/booking-status";
import { getAnalytics } from "@/modules/dashboard/analytics";
import { getKpis, getPipeline } from "@/modules/dashboard/service";
import { bulkUpdateOrderStatus } from "@/modules/orders/bulk-status";
import { bulkOrderStatusSchema, confirmShopifyPaymentSchema, createOrderSchema, orderListQuery, updateOrderAddressSchema, updateOrderWeightsSchema } from "@/modules/orders/schema";
import {
  confirmCustomerOrderLinkSchema,
} from "@/modules/customer-order-links/schema";
import {
  confirmLegacyCustomerOrderLink,
  confirmWhatsAppCollectionOrder,
  getMerchantCollectionLink,
  listLegacySubmissions,
  listWhatsAppPendingOrders,
} from "@/modules/customer-order-links/service";
import { confirmShopifyPayment, createManualOrder, exportOrdersCsv, getOrder, listOrders, setOrderBookingService, updateOrderShippingAddress, updateOrderWeights } from "@/modules/orders/service";
import { labelPdfFileResponse, labelPdfViewerResponse, wantsBrowserPdfPreview } from "@/lib/labels/pdf-response";
import { loadLabelPdfBytes } from "@/modules/labels/load";
import { renderCustomShippingLabel } from "@/modules/labels/custom-label-service";
import {
  generateAndStoreOfficialIndiaPostLabelPdf,
  indiaPostLabelRequestError,
} from "@/modules/labels/official-fetch";
import { fetchReceiptPdf } from "@/modules/labels/receipt";
import { getLabelDashboardCounts, listGroupedLabels } from "@/modules/labels/list";
import { getLabelTemplate } from "@/modules/labels/template-service";
import { defaultLabelTemplateId } from "@/modules/labels/template-schema";
import {
  createShipmentsForOrders,
  getShipment,
  listShipments,
  retryShipment,
  setOrderShipmentDimensions,
  updateShipmentDimensions,
  updateShipmentDimensionsSchema,
} from "@/modules/shipments/service";
import { ndrListQuery, ndrVisibleSyncBody } from "@/modules/ndr-rto/schema";
import { getNdrSummary, listNdrShipments, syncNdrShipment, syncNdrVisibleShipments } from "@/modules/ndr-rto/service";
import {
  queueExcelBuffer,
  queueValidatedOrders,
  summarizeBulkBookings,
  validateExcelBuffer,
  validateOrdersForBooking,
} from "@/modules/india-post/bulk-booking";
import { logError } from "@/lib/logger";
import { backfillMissingShopifyLineItemImages } from "@/modules/shopify/orders";

function fillShopifyLineItemImages(supabase: SupabaseClient, organizationId: string) {
  const run = () =>
    backfillMissingShopifyLineItemImages(supabase, organizationId).catch((error) => {
      logError("shopify.line-item-images.backfill", {
        organizationId,
        message: error instanceof Error ? error.message : "unknown",
      });
    });
  try {
    after(run);
  } catch {
    void run();
  }
}

function dateRange(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from") || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = request.nextUrl.searchParams.get("to") || new Date().toISOString().slice(0, 10);
  return { from, to };
}

async function officialIndiaPostLabelPdfResponse(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentId: string
) {
  const filename = `india-post-label-${shipmentId}.pdf`;
  try {
    const official = await generateAndStoreOfficialIndiaPostLabelPdf(
      supabase,
      organizationId,
      shipmentId
    );
    const response = labelPdfFileResponse(official.pdf, filename);
    response.headers.set("X-Label-Source", "india-post");
    return response;
  } catch (error) {
    logError("LABEL_LATEST_FETCH_FAILED", {
      organizationId,
      shipmentId,
      message: error instanceof Error ? error.message : "unknown",
    });
    throw indiaPostLabelRequestError(error);
  }
}

export async function handleCommerceRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  key: string,
  method: string,
  slugs: string[]
) {
  if (key === "GET dashboard/kpis") {
    const { from, to } = dateRange(request);
    return getKpis(supabase, ctx, from, to);
  }

  if (key === "GET dashboard/pipeline") {
    const { from, to } = dateRange(request);
    return getPipeline(supabase, ctx, from, to);
  }

  if (key === "GET dashboard/analytics") {
    return getAnalytics(supabase, ctx);
  }

  if (key === "GET orders") {
    const parsed = orderListQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
    fillShopifyLineItemImages(supabase, ctx.organizationId);
    return listOrders(supabase, ctx, parsed);
  }

  if (key === "GET orders/export") {
    const parsed = orderListQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
    const csv = await exportOrdersCsv(supabase, ctx, parsed);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=orders.csv",
      },
    });
  }

  if (key === "GET orders/customer-links") {
    const [link, pending, legacy] = await Promise.all([
      getMerchantCollectionLink(supabase, ctx),
      listWhatsAppPendingOrders(supabase, ctx),
      listLegacySubmissions(supabase, ctx),
    ]);
    return { link, pending, legacy };
  }

  if (key === "POST orders/customer-links") {
    return getMerchantCollectionLink(supabase, ctx);
  }

  if (method === "POST" && slugs[0] === "orders" && slugs[1] === "customer-links" && slugs[2] && slugs[3] === "confirm") {
    const body = confirmCustomerOrderLinkSchema.parse(await request.json());
    return confirmLegacyCustomerOrderLink(supabase, ctx, slugs[2], body);
  }

  if (method === "POST" && slugs[0] === "orders" && slugs[1] && slugs[2] === "whatsapp-confirm") {
    const body = confirmCustomerOrderLinkSchema.parse(await request.json());
    return confirmWhatsAppCollectionOrder(supabase, ctx, slugs[1], body);
  }

  if (method === "POST" && slugs[0] === "orders" && slugs[1] && slugs[2] === "shopify-payment") {
    const body = confirmShopifyPaymentSchema.parse(await request.json());
    return confirmShopifyPayment(supabase, ctx, slugs[1], body.paymentType);
  }

  if (method === "PATCH" && slugs[0] === "orders" && slugs[1] && slugs[2] === "service") {
    const body = await request.json();
    return setOrderBookingService(supabase, ctx, slugs[1], String(body.service ?? ""));
  }

  if (method === "PATCH" && slugs[0] === "orders" && slugs[1] && slugs[2] === "weights") {
    const body = updateOrderWeightsSchema.parse(await request.json());
    return updateOrderWeights(supabase, ctx, slugs[1], body);
  }

  if (method === "PATCH" && slugs[0] === "orders" && slugs[1] && slugs[2] === "address") {
    const body = updateOrderAddressSchema.parse(await request.json());
    return updateOrderShippingAddress(supabase, ctx, slugs[1], body);
  }

  if (method === "PATCH" && slugs[0] === "orders" && slugs[1] && slugs[2] === "dimensions") {
    const body = updateShipmentDimensionsSchema.parse(await request.json());
    return setOrderShipmentDimensions(supabase, ctx, slugs[1], body);
  }

  if (method === "GET" && slugs[0] === "orders" && slugs[1]) {
    fillShopifyLineItemImages(supabase, ctx.organizationId);
    return getOrder(supabase, ctx, slugs[1]);
  }

  if (key === "GET ai-credits") {
    const { getAiCreditsSnapshot } = await import("@/modules/ai-credits/service");
    return getAiCreditsSnapshot(supabase, ctx.organizationId);
  }

  if (key === "GET ai-credits/ledger") {
    const { listAiCreditLedger } = await import("@/modules/ai-credits/service");
    return { entries: await listAiCreditLedger(supabase, ctx.organizationId) };
  }

  if (key === "POST ai-credits/quote") {
    const { quoteMerchantAiCredits } = await import("@/modules/ai-credits/service");
    const body = (await request.json().catch(() => ({}))) as { packageId?: string; credits?: unknown };
    return quoteMerchantAiCredits({ packageId: body.packageId, credits: body.credits });
  }

  if (key === "POST orders/whatsapp-parse") {
    const { parseWhatsAppOrderPaste, whatsappPasteSchema } = await import("@/modules/openrouter/parse-whatsapp");
    const body = whatsappPasteSchema.parse(await request.json());
    return parseWhatsAppOrderPaste(body.text, {
      organizationId: ctx.organizationId,
      supabase,
      idempotencyKey: body.idempotencyKey,
    });
  }

  if (key === "POST orders") {
    const body = createOrderSchema.parse(await request.json());
    if ((body.source ?? "MANUAL") === "WHATSAPP") {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "WhatsApp orders must be created from the storefront.");
    }
    const order = await createManualOrder(supabase, ctx, body);
    if (!body.createShipment) return order;
    try {
      await createShipmentsForOrders(supabase, ctx, [order.id], body.shipment);
    } catch (error) {
      logError("orders.create_shipment_failed", {
        orderId: order.id,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
    const { data: shipment } = await supabase
      .from("shipments")
      .select("id, order_id, status, barcode, booked_at, last_error")
      .eq("organization_id", ctx.organizationId)
      .eq("order_id", order.id)
      .not("status", "eq", "CANCELLED")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { ...order, shipment: shipment ?? null };
  }

  if (key === "POST orders/bulk/status") {
    const body = bulkOrderStatusSchema.parse(await request.json());
    return bulkUpdateOrderStatus(supabase, ctx, body);
  }

  if (key === "POST bookings/validate") {
    const body = await request.json();
    const orderIds: string[] = body.orderIds ?? [];
    return validateOrdersForBooking(supabase, ctx, orderIds);
  }

  if (key === "POST bookings/queue") {
    const body = await request.json();
    const orderIds: string[] = body.orderIds ?? [];
    return queueValidatedOrders(supabase, ctx, orderIds);
  }

  if (key === "GET bookings/summary") {
    const orderIds = (request.nextUrl.searchParams.get("orderIds") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    return summarizeBulkBookings(supabase, ctx, orderIds);
  }

  if (key === "POST bookings/excel") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Upload an India Post Excel workbook.");
    }
    const bytes = await file.arrayBuffer();
    const queue = String(form.get("queue") ?? "") === "true";
    return queue ? queueExcelBuffer(supabase, ctx, bytes) : validateExcelBuffer(supabase, ctx, bytes);
  }

  if (key === "GET ndr-rto/summary") {
    return getNdrSummary(supabase, ctx);
  }

  if (key === "GET ndr-rto") {
    const parsed = ndrListQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
    return listNdrShipments(supabase, ctx, parsed);
  }

  if (method === "POST" && slugs[0] === "ndr-rto" && slugs[1] === "sync-visible") {
    const body = ndrVisibleSyncBody.parse(await request.json());
    return syncNdrVisibleShipments(supabase, ctx, body.shipmentIds);
  }

  if (method === "POST" && slugs[0] === "ndr-rto" && slugs[1] && slugs[2] === "sync") {
    return syncNdrShipment(supabase, ctx, slugs[1]);
  }

  if (key === "GET shipments") {
    return listShipments(supabase, ctx, {
      page: Number(request.nextUrl.searchParams.get("page") || 1),
      pageSize: Number(request.nextUrl.searchParams.get("pageSize") || 20),
      q: request.nextUrl.searchParams.get("q") || undefined,
      status: request.nextUrl.searchParams.get("status") || undefined,
      orderId: request.nextUrl.searchParams.get("orderId") || undefined,
      serviceCode: request.nextUrl.searchParams.get("serviceCode") || undefined,
    });
  }

  if (key === "POST shipments") {
    const body = await request.json();
    const orderIds: string[] = body.orderIds ?? (body.orderId ? [body.orderId] : []);
    return createShipmentsForOrders(supabase, ctx, orderIds, body);
  }

  if (method === "GET" && slugs[0] === "shipments" && slugs[1] && !slugs[2]) {
    return getShipment(supabase, ctx, slugs[1]);
  }

  if (method === "POST" && slugs[0] === "shipments" && slugs[2] === "retry") {
    const body = await request.json().catch(() => ({}));
    return retryShipment(supabase, ctx, slugs[1], body);
  }

  if (method === "POST" && slugs[0] === "shipments" && slugs[2] === "india-post-label") {
    const { data: shipment } = await supabase
      .from("shipments")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", slugs[1])
      .maybeSingle();
    if (!shipment?.id) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Shipment not found.");
    return officialIndiaPostLabelPdfResponse(supabase, ctx.organizationId, String(shipment.id));
  }

  if (method === "PATCH" && slugs[0] === "shipments" && slugs[1] && !slugs[2]) {
    const body = updateShipmentDimensionsSchema.parse(await request.json());
    return updateShipmentDimensions(supabase, ctx, slugs[1], body);
  }

  if (key === "GET labels/summary") {
    return getLabelDashboardCounts(supabase, ctx);
  }

  if (key === "GET labels") {
    const params = request.nextUrl.searchParams;
    const page = Number(params.get("page") || 1);
    const pageSize = Number(params.get("pageSize") || 20);
    const kind = params.get("kind");
    const q = params.get("q");
    return listGroupedLabels(supabase, ctx, {
      page,
      pageSize,
      kind,
      q,
      date: params.get("date"),
      on: params.get("on"),
      from: params.get("from"),
      to: params.get("to"),
    });
  }

  if (method === "GET" && slugs[0] === "labels" && slugs[2] === "download") {
    const { data } = await supabase
      .from("labels")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .eq("id", slugs[1])
      .maybeSingle();
    if (!data?.file_path && !data?.file_url) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Label file not found.");
    }
    const bytes = await loadLabelPdfBytes(supabase, ctx.organizationId, {
      id: String(data.id),
      file_path: data.file_path || "",
      file_url: data.file_url,
      shipment_id: data.shipment_id,
    });
    const kind = String(data.kind || "INDIA_POST").toUpperCase();
    const filename =
      kind === "MERCHANT"
        ? `packing-slip-${data.shipment_id || data.id}.pdf`
        : kind === "CUSTOM_SHIPPING"
          ? `shipping-label-${data.shipment_id || data.id}.pdf`
          : `india-post-${data.shipment_id || data.id}.pdf`;
    if (wantsBrowserPdfPreview(request)) {
      return labelPdfViewerResponse(filename);
    }
    return labelPdfFileResponse(bytes, filename);
  }

  if (method === "GET" && slugs[0] === "labels" && slugs[1] && slugs[2] === "latest") {
    const { data: row } = await supabase
      .from("labels")
      .select("id, shipment_id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", slugs[1])
      .maybeSingle();
    if (!row?.shipment_id) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Label not found.");
    return officialIndiaPostLabelPdfResponse(supabase, ctx.organizationId, String(row.shipment_id));
  }

  if (method === "POST" && slugs[0] === "labels" && slugs[1] && slugs[2] === "india-post") {
    const { data: row } = await supabase
      .from("labels")
      .select("id, shipment_id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", slugs[1])
      .maybeSingle();
    if (!row?.shipment_id) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Label not found.");
    return officialIndiaPostLabelPdfResponse(supabase, ctx.organizationId, String(row.shipment_id));
  }

  if (method === "GET" && slugs[0] === "labels" && slugs[1] && slugs[2] === "shipping-slip") {
    const { data: row } = await supabase
      .from("labels")
      .select("id, shipment_id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", slugs[1])
      .maybeSingle();
    if (!row?.shipment_id) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Label not found.");
    const shipmentId = String(row.shipment_id);
    const { data: shipment } = await supabase
      .from("shipments")
      .select("id, barcode, booked_at")
      .eq("organization_id", ctx.organizationId)
      .eq("id", shipmentId)
      .maybeSingle();
    const { data: official } = await supabase
      .from("labels")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("shipment_id", shipmentId)
      .eq("kind", "INDIA_POST")
      .eq("status", "READY")
      .limit(1)
      .maybeSingle();
    if (!shipment?.barcode || !shipment.booked_at || !official?.id) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Generate the India Post label first.");
    }
    const stored = await getLabelTemplate(supabase, ctx.organizationId);
    const rendered = await renderCustomShippingLabel(supabase, ctx.organizationId, {
      shipmentId,
      templateId: defaultLabelTemplateId(stored),
    });
    const articleId = rendered.data.articleId?.trim() || shipmentId;
    return labelPdfFileResponse(rendered.pdf, `shipping-slip-${articleId}.pdf`);
  }

  if (method === "GET" && slugs[0] === "labels" && slugs[1] && slugs[2] === "receipt") {
    const { data: row } = await supabase
      .from("labels")
      .select("id, shipment_id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", slugs[1])
      .maybeSingle();
    if (!row?.shipment_id) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Label not found.");
    try {
      const receipt = await fetchReceiptPdf(supabase, ctx.organizationId, String(row.shipment_id));
      return labelPdfFileResponse(receipt.pdf, `india-post-receipt-${receipt.articleId}.pdf`);
    } catch (error) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        error instanceof Error ? error.message : "Could not create the receipt."
      );
    }
  }

  if (key === "POST labels/bulk-download") {
    const body = await request.json().catch(() => ({}));
    const ids = parseBulkPrintIds((body as { ids?: unknown }).ids);
    const prepared = await prepareBulkShippingSlips(supabase, ctx, ids);
    return labelPdfFileResponse(prepared.merged.pdf, "shipping-slips.pdf", "attachment");
  }

  if (key === "POST labels/bulk-print") {
    assertBrowserOrigin(request, true);
    if (!hasPermission(ctx.role, "labels.write")) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "You do not have permission to print labels.");
    }
    const body = await request.json().catch(() => ({}));
    const ids = parseBulkPrintIds((body as { ids?: unknown }).ids);
    const rawKey = requirePrintIdempotencyKey(request.headers.get("idempotency-key"));
    const fingerprint = printRequestFingerprint({
      action: "bulk-slip-print",
      ids: [...ids].sort(),
    });
    const claimed = await claimManualPrintKey(supabase, ctx.organizationId, rawKey, fingerprint);
    if (claimed.cached) return claimed.cached;
    try {
      const printed = await printBulkShippingSlips(supabase, ctx, ids, { idempotencyKey: claimed.key });
      const result = {
        labelId: printed.labelId,
        pageCount: printed.pageCount,
        slipCount: printed.slipCount,
        job: printed.job,
        connected: printed.connected,
        downloadPath: printed.downloadPath,
        message: printed.message,
      };
      await storeManualPrintKey(supabase, ctx.organizationId, claimed.key, result);
      return result;
    } catch (error) {
      await releaseManualPrintKey(supabase, ctx.organizationId, claimed.key);
      throw error;
    }
  }

  if (key === "GET tracking") {
    const q = request.nextUrl.searchParams.get("q");
    let builder = supabase
      .from("shipments")
      .select("*, orders(order_number), tracking_events(*)")
      .eq("organization_id", ctx.organizationId)
      .not("barcode", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);
    const filter = q ? orIlike(["barcode", "tracking_number"], q) : null;
    if (filter) builder = builder.or(filter);
    const { data } = await builder;
    return {
      items: (data ?? []).map((row) => ({
        ...row,
        status: indiaPostDisplayShipmentStatus(row),
        orderNumber: (row.orders as { order_number?: string } | null)?.order_number,
        events: row.tracking_events ?? [],
      })),
    };
  }

  return null;
}
