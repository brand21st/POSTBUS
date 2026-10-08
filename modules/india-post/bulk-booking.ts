import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { whatsappShipmentBlocked } from "@/lib/dashboard/records";
import { allocateNextBarcode } from "@/modules/india-post/allocate-barcode";
import { mapExcelRowToArticle, mapShipmentToArticle } from "@/modules/india-post/article-mapper";
import type { DraftArticle, DraftPickup, ValidationIssue } from "@/modules/india-post/article-types";
import { isValidIndiaPostBarcode, validateIndiaPostArticle } from "@/modules/india-post/article-validator";
import { effectiveIndiaPostBookingBatchSize } from "@/modules/india-post/bulk-config";
import { candidatesFromQueuedShipments, enqueueIndiaPostBulkPlan, planIndiaPostBulkWork } from "@/modules/india-post/bulk-engine";
import { parseIndiaPostBookingWorkbook } from "@/modules/india-post/excel-ingest";
import { indiaPostMobile } from "@/modules/india-post/endpoints";
import { resolveIndiaPostOrigin } from "@/modules/india-post/origin";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import { resolveOrderBookingService } from "@/modules/india-post/booking-service";
import { resolveDefaultServiceCode, savedParcelContracts } from "@/modules/india-post/contracts";
import { createBackgroundJob } from "@/modules/jobs/service";
import { createManualOrder } from "@/modules/orders/service";
import { shipmentCollectFromOrder } from "@/modules/orders/payment";
import { bookingBoxWeightGrams, hasDeclaredBookingWeight } from "@/modules/orders/weight";
import { applyWorkspaceParcelDefaults, parcelDefaultsFromConnection } from "@/modules/india-post/parcel-defaults";
import { organizationLabelSender } from "@/modules/organizations/label-sender";
import { createShipmentsForOrders } from "@/modules/shipments/service";
import { isIndiaPostAcceptedStatus } from "@/modules/india-post/booking-status";
import { indiaPostRequiresOtp } from "@/modules/india-post/spec";
import { DEFAULT_INDIA_POST_SERVICE } from "@/types/domain";

export type BulkBookingRow = {
  orderId?: string;
  orderNumber?: string;
  shipmentId?: string;
  barcode?: string;
  valid: boolean;
  issues: ValidationIssue[];
  status: string;
};

export type BulkBookingResult = {
  total: number;
  valid: number;
  invalid: number;
  queued: number;
  processing: number;
  booked: number;
  failed: number;
  retrying: number;
  labelsGenerated: number;
  manifestEligible: number;
  rows: BulkBookingRow[];
  issues: ValidationIssue[];
};

async function loadStoreContext(supabase: SupabaseClient, organizationId: string) {
  const [{ data: connection }, { data: pickup }, { data: org }, { data: shop }, defaultService, { data: contracts }] =
    await Promise.all([
      supabase.from("india_post_connections").select("*").eq("organization_id", organizationId).maybeSingle(),
      supabase
        .from("pickup_locations")
        .select("*")
        .eq("organization_id", organizationId)
        .order("is_default", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("organizations").select("name, phone, line1, line2, city, state, pincode").eq("id", organizationId).maybeSingle(),
      supabase.from("shopify_stores").select("shop_name").eq("organization_id", organizationId).maybeSingle(),
      resolveDefaultServiceCode(supabase, organizationId),
      supabase
        .from("india_post_contracts")
        .select("service_code, contract_id, is_active")
        .eq("organization_id", organizationId),
    ]);
  const allowedServices = savedParcelContracts({
    contracts: (contracts ?? []).map((row) => ({
      serviceCode: String(row.service_code ?? ""),
      contractId: String(row.contract_id ?? ""),
      isActive: row.is_active !== false,
    })),
  }).map((contract) => contract.serviceCode);
  return { connection, pickup, org, shop, defaultService, allowedServices };
}

function isRetryingShipment(row: { status?: string | null; last_error_code?: string | null }) {
  const status = String(row.status ?? "").toUpperCase();
  const code = String(row.last_error_code ?? "").toUpperCase();
  if (!code) return false;
  if (status === "QUEUED") return true;
  if (status === "RECOVERY_REQUIRED") return true;
  if (status === "BOOKING" && (code === "ETIMEDOUT" || code === "TEMPORARY_PROVIDER_FAILURE" || code === "CEPT_UNKNOWN")) {
    return true;
  }
  return false;
}

export function countsFromShipments(
  shipments: Array<{ status?: string | null; last_error_code?: string | null }>
) {
  const statusOf = (value?: string | null) => String(value ?? "").toUpperCase();
  const retrying = shipments.filter((row) => isRetryingShipment(row)).length;
  const queued = shipments.filter((row) => statusOf(row.status) === "QUEUED" && !isRetryingShipment(row)).length;
  return {
    queued,
    retrying,
    processing: shipments.filter((row) => ["BOOKING", "VALIDATING"].includes(statusOf(row.status)) && !isRetryingShipment(row))
      .length,
    booked: shipments.filter((row) => isIndiaPostAcceptedStatus(row.status)).length,
    failed: shipments.filter((row) => statusOf(row.status) === "FAILED").length,
    labelsGenerated: shipments.filter((row) =>
      ["LABEL_READY", "MANIFEST_PENDING", "MANIFEST_READY"].includes(statusOf(row.status))
    ).length,
    manifestEligible: shipments.filter((row) =>
      ["LABEL_READY", "MANIFEST_PENDING", "MANIFEST_READY"].includes(statusOf(row.status))
    ).length,
  };
}

export async function summarizeBulkBookings(
  supabase: SupabaseClient,
  ctx: TenantContext,
  orderIds: string[]
): Promise<BulkBookingResult> {
  const ids = [...new Set(orderIds)].slice(0, 500);
  const { data: shipments } = await supabase
    .from("shipments")
    .select("id, order_id, status, barcode, last_error_code")
    .eq("organization_id", ctx.organizationId)
    .in("order_id", ids);
  const stats = countsFromShipments(shipments ?? []);
  return {
    total: ids.length,
    valid: 0,
    invalid: 0,
    ...stats,
    rows: [],
    issues: [],
  };
}

export async function validateOrdersForBooking(
  supabase: SupabaseClient,
  ctx: TenantContext,
  orderIds: string[]
): Promise<BulkBookingResult> {
  const ids = [...new Set(orderIds)];
  if (!ids.length) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Select at least one order.");
  if (ids.length > 500) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Validate at most 500 orders at a time.");

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      "*, order_line_items(quantity, weight_grams), shipping_address:addresses!shipping_address_id(*), shipments(id, status, barcode, service_code, payment_mode, cod_amount, weight_grams, length_cm, width_cm, height_cm)"
    )
    .eq("organization_id", ctx.organizationId)
    .in("id", ids);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if ((orders ?? []).length !== ids.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "One or more orders were not found in this workspace.");
  }

  const store = await loadStoreContext(supabase, ctx.organizationId);
  if (!store.connection || store.connection.status === "NOT_CONNECTED") {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "India Post is not connected.");
  }

  const { data: contracts } = await supabase
    .from("india_post_contracts")
    .select("service_code, contract_id")
    .eq("organization_id", ctx.organizationId)
    .eq("is_active", true);
  const contractByService = new Map((contracts ?? []).map((row) => [row.service_code as string, row.contract_id as string]));

  const sender = organizationLabelSender(store.org, store.pickup, store.shop?.shop_name);
  const provider = indiaPostFromRow(store.connection);
  const destSample =
    (orders?.[0] as { shipping_address?: { pincode?: string } } | undefined)?.shipping_address?.pincode ?? "";
  let origin: { officeId: string; pincode: string; city: string; state: string } | null = null;
  try {
    origin = await resolveIndiaPostOrigin(
      provider,
      store.connection,
      {
        ...store.pickup,
        pincode: sender.pincode || store.pickup?.pincode,
        city: sender.city || store.pickup?.city,
        state: sender.state || store.pickup?.state,
      },
      destSample
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pickup office is not configured.";
    const issues: ValidationIssue[] = ids.map((id) => ({
      orderId: id,
      field: "pickup_dropoff_office_id",
      value: "",
      error: message,
      status: "Failed",
      category: "POSTBUS_CONFIG",
    }));
    return { total: ids.length, valid: 0, invalid: ids.length, queued: 0, retrying: 0, processing: 0, booked: 0, failed: 0, labelsGenerated: 0, manifestEligible: 0, rows: [], issues };
  }

  const rows: BulkBookingRow[] = [];
  const issues: ValidationIssue[] = [];
  const barcodes = new Set<string>();
  const shipmentStats = countsFromShipments(orders?.flatMap((order) => (order.shipments as Array<{ status?: string }>) ?? []) ?? []);

  for (const order of orders ?? []) {
    const address = order.shipping_address as {
      name?: string;
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      pincode?: string;
      phone?: string;
    } | null;
    if (
      whatsappShipmentBlocked({
        source: (order as { source?: string }).source,
        status: (order as { status?: string }).status,
        payment_status: (order as { payment_status?: string }).payment_status,
      })
    ) {
      const issue: ValidationIssue = {
        orderId: order.id,
        orderNumber: order.order_number,
        barcode: "",
        field: "order",
        value: order.order_number,
        error: "WhatsApp orders cannot be booked until they are READY.",
        status: "Failed",
        category: "BOOKING",
      };
      issues.push(issue);
      rows.push({
        orderId: order.id,
        orderNumber: order.order_number,
        shipmentId: "",
        barcode: "",
        valid: false,
        issues: [issue],
        status: String((order as { status?: string }).status ?? ""),
      });
      continue;
    }
    const existing = ((order.shipments as Array<Record<string, unknown>>) ?? [])[0];
    const existingStatus = String(existing?.status ?? "");
    if (existing && isIndiaPostAcceptedStatus(existingStatus)) {
      const issue: ValidationIssue = {
        orderId: order.id,
        orderNumber: order.order_number,
        barcode: String(existing.barcode ?? ""),
        field: "order",
        value: order.order_number,
        error: "This order is already booked.",
        status: "Failed",
        category: "BOOKING",
      };
      issues.push(issue);
      rows.push({
        orderId: order.id,
        orderNumber: order.order_number,
        shipmentId: String(existing.id),
        barcode: String(existing.barcode ?? ""),
        valid: false,
        issues: [issue],
        status: existingStatus,
      });
      continue;
    }

    const serviceCode = resolveOrderBookingService({
      orderService: order.india_post_service,
      workspaceOverride: store.connection.booking_service_override,
      defaultService: store.defaultService,
      allowedServices: store.allowedServices,
    });
    const contractId = contractByService.get(serviceCode) || store.connection.contract_id;
    const lineItems = (order.order_line_items as Array<{ quantity?: number; weight_grams?: number }>) ?? [];
    const declared = hasDeclaredBookingWeight({
      parcelWeightMode: order.parcel_weight_mode,
      parcelWeightGrams: order.parcel_weight_grams,
      lineItems,
    });
    const weight = declared
      ? bookingBoxWeightGrams({
          parcelWeightMode: order.parcel_weight_mode,
          parcelWeightGrams: order.parcel_weight_grams,
          lineItems,
        })
      : 0;
    const collect = shipmentCollectFromOrder(order);
    const draft: DraftArticle = applyWorkspaceParcelDefaults(
      mapShipmentToArticle({
      orderId: order.id,
      orderNumber: order.order_number,
      shipmentId: existing ? String(existing.id) : undefined,
      serviceCode,
      customerId: String(store.connection.bulk_customer_id ?? ""),
      contractId: String(contractId ?? ""),
      officeId: origin.officeId,
      originPin: origin.pincode,
      weightGrams: weight,
      lengthCm: Number(existing?.length_cm) || 0,
      widthCm: Number(existing?.width_cm) || 0,
      heightCm: Number(existing?.height_cm) || 0,
      senderName: sender.name,
      senderCompany: store.org?.name || store.pickup?.name || sender.name,
      senderLine1: sender.line1,
      senderLine2: sender.line2,
      senderCity: sender.city || origin.city,
      senderState: sender.state || origin.state,
      senderPin: origin.pincode,
      senderMobile: indiaPostMobile(sender.phone) || "",
      receiverName: address?.name ?? "",
      receiverCompany: address?.name ?? "",
      receiverLine1: address?.line1 ?? "",
      receiverLine2: address?.line2 ?? "",
      receiverCity: address?.city ?? "",
      receiverState: address?.state ?? "",
      receiverPin: address?.pincode ?? "",
      receiverMobile: indiaPostMobile(address?.phone) || "",
      paymentMode: collect.payment_mode,
      codAmount: collect.cod_amount,
      strictWeight: true,
      strictDimensions: true,
    }),
      parcelDefaultsFromConnection(store.connection)
    );
    const rowIssues = validateIndiaPostArticle(draft);
    if (draft.barcode) {
      const key = draft.barcode.toUpperCase();
      if (barcodes.has(key)) {
        rowIssues.push({
          orderId: order.id,
          orderNumber: order.order_number,
          barcode: key,
          field: "barcode_no",
          value: key,
          error: "Duplicate barcode in this bulk selection.",
          status: "Failed",
          category: "MAPPING",
        });
      }
      barcodes.add(key);
    }
    issues.push(...rowIssues);
    rows.push({
      orderId: order.id,
      orderNumber: order.order_number,
      shipmentId: existing ? String(existing.id) : undefined,
      valid: rowIssues.length === 0,
      issues: rowIssues,
      status: rowIssues.length ? "INVALID" : "VALID",
    });
  }

  const valid = rows.filter((row) => row.valid).length;
  return {
    total: ids.length,
    valid,
    invalid: ids.length - valid,
    ...shipmentStats,
    rows,
    issues,
  };
}

export async function queueValidatedOrders(
  supabase: SupabaseClient,
  ctx: TenantContext,
  orderIds: string[]
) {
  const validation = await validateOrdersForBooking(supabase, ctx, orderIds);
  const validIds = validation.rows.filter((row) => row.valid && row.orderId).map((row) => row.orderId as string);
  if (!validIds.length) {
    return { ...validation, queued: 0 };
  }
  if (effectiveIndiaPostBookingBatchSize() === 1) {
    const created = await createShipmentsForOrders(supabase, ctx, validIds, { enqueueBooking: true });
    return { ...validation, queued: created.queued };
  }
  const created = await createShipmentsForOrders(supabase, ctx, validIds, { enqueueBooking: false });
  const shipmentIds = created.shipments.map((row: { id: string }) => row.id);
  const bookingJobs = await enqueueQueuedShipmentsAsBulkOrSingle(supabase, ctx, shipmentIds);
  const { claimedJobFromRow, startQueuedBookingJobs } = await import("@/lib/jobs/drain");
  await startQueuedBookingJobs(bookingJobs.map(claimedJobFromRow));
  return { ...validation, queued: shipmentIds.length };
}

async function enqueueQueuedShipmentsAsBulkOrSingle(
  supabase: SupabaseClient,
  ctx: TenantContext,
  shipmentIds: string[]
) {
  if (!shipmentIds.length) return [];
  const store = await loadStoreContext(supabase, ctx.organizationId);
  const { data: memberRows } = await supabase
    .from("shipments")
    .select("id, organization_id, barcode, service_code, status, created_at, length_cm, width_cm, height_cm, weight_grams")
    .eq("organization_id", ctx.organizationId)
    .in("id", shipmentIds);
  const { data: contracts } = await supabase
    .from("india_post_contracts")
    .select("service_code, contract_id")
    .eq("organization_id", ctx.organizationId)
    .eq("is_active", true);
  const contractByService = Object.fromEntries(
    (contracts ?? []).map((row) => [String(row.service_code), String(row.contract_id)])
  );
  const { data: activeMembers } = await supabase
    .from("india_post_bulk_batch_articles")
    .select("shipment_id")
    .in("shipment_id", shipmentIds)
    .in("article_result", ["PENDING", "SUBMITTED", "SUCCEEDED", "RECOVERY_REQUIRED"]);
  const plan = memberRows?.length
    ? planIndiaPostBulkWork(
        candidatesFromQueuedShipments(memberRows, store.connection ?? {}, contractByService),
        { activeShipmentIds: new Set((activeMembers ?? []).map((row) => String(row.shipment_id))) }
      )
    : { batches: [], leftoverShipmentIds: shipmentIds };
  await supabase
    .from("shipments")
    .update({ status: "QUEUED", last_error: null, last_error_code: null })
    .eq("organization_id", ctx.organizationId)
    .in("id", shipmentIds);
  return enqueueIndiaPostBulkPlan(supabase, ctx, plan);
}

function pickupFromExcel(row?: Record<string, string> | null): DraftPickup | null {
  if (!row) return null;
  return {
    addresseeName: row.addressee_name || "",
    companyName: row.company_name || "",
    line1: row.address_line1 || "",
    line2: row.address_line2,
    line3: row.address_line3,
    city: row.city || "",
    state: row.state,
    pincode: row.pincode || "",
    email: row.email_id,
    altContact: row.alt_contact_no,
    mobile: row.mobile_no || "",
    scheduleSlot: row.pickup_schedule_slot || "",
    scheduleDate: row.pickup_schedule_date || "",
  };
}

export async function validateExcelBuffer(
  supabase: SupabaseClient,
  ctx: TenantContext,
  bytes: ArrayBuffer
): Promise<BulkBookingResult> {
  const parsed = await parseIndiaPostBookingWorkbook(bytes);
  const store = await loadStoreContext(supabase, ctx.organizationId);
  if (!store.connection || store.connection.status === "NOT_CONNECTED") {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "India Post is not connected.");
  }
  const serviceCode = resolveOrderBookingService({
    orderService: null,
    workspaceOverride: store.connection.booking_service_override,
    defaultService: store.defaultService || DEFAULT_INDIA_POST_SERVICE,
    allowedServices: store.allowedServices,
  });
  const { data: contract } = await supabase
    .from("india_post_contracts")
    .select("contract_id")
    .eq("organization_id", ctx.organizationId)
    .eq("service_code", serviceCode)
    .eq("is_active", true)
    .maybeSingle();
  const contractId = contract?.contract_id || store.connection.contract_id;
  const sender = organizationLabelSender(store.org, store.pickup, store.shop?.shop_name);
  const provider = indiaPostFromRow(store.connection);
  let origin;
  try {
    origin = await resolveIndiaPostOrigin(provider, store.connection, store.pickup, sender.pincode || "110001");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pickup office is not configured.";
    return {
      total: parsed.articles.length,
      valid: 0,
      invalid: parsed.articles.length,
      queued: 0,
      retrying: 0,
      processing: 0,
      booked: 0,
      failed: 0,
      labelsGenerated: 0,
      manifestEligible: 0,
      rows: [],
      issues: [
        ...parsed.issues,
        { field: "pickup_dropoff_office_id", value: "", error: message, status: "Failed", category: "POSTBUS_CONFIG" },
      ],
    };
  }

  const { data: existingBarcodes } = await supabase
    .from("shipments")
    .select("barcode")
    .eq("organization_id", ctx.organizationId)
    .not("barcode", "is", null);
  const used = new Set((existingBarcodes ?? []).map((row) => String(row.barcode).toUpperCase()));
  const seen = new Set<string>();
  const rows: BulkBookingRow[] = [];
  const issues: ValidationIssue[] = [...parsed.issues];

  for (const article of parsed.articles) {
    const serial = article.serial_number || "";
    const draft = applyWorkspaceParcelDefaults(
      mapExcelRowToArticle({
      serial,
      serviceCode,
      customerId: String(store.connection.bulk_customer_id ?? ""),
      contractId: String(contractId ?? ""),
      officeId: origin.officeId,
      pickupOfficeId: String(store.connection.pickup_office_id ?? ""),
      originPin: origin.pincode,
      row: article,
      pickup: pickupFromExcel(parsed.pickups.get(serial)),
      alt: (() => {
        const alt = parsed.alts.get(serial);
        if (!alt) return null;
        return {
          addresseeName: alt.addressee_name || "",
          companyName: alt.company_name || "",
          line1: alt.address_line1 || "",
          line2: alt.address_line2,
          line3: alt.address_line3,
          city: alt.city || "",
          state: alt.state,
          pincode: alt.pincode || "",
          email: alt.email_id,
          contact: alt.alt_contact_no,
          mobile: alt.mobile_no || "",
        };
      })(),
    }),
      parcelDefaultsFromConnection(store.connection)
    );
    if (indiaPostRequiresOtp(serviceCode)) {
      if (article.otp && ["0", "FALSE", "false", ""].includes(article.otp)) {
        issues.push({
          orderNumber: serial,
          field: "otp",
          value: article.otp,
          error: "OTP must be TRUE for 24_SPP_PARSPL bookings.",
          status: "Failed",
          category: "INDIA_POST_VALIDATION",
        });
      }
    } else if (article.otp && !["0", "FALSE", "false", ""].includes(article.otp)) {
      issues.push({
        orderNumber: serial,
        field: "otp",
        value: article.otp,
        error: "OTP based delivery is only used for 24_SPP_PARSPL.",
        status: "Failed",
        category: "MAPPING",
      });
    }
    const rowIssues = validateIndiaPostArticle(draft);
    const barcode = (draft.barcode || "").toUpperCase();
    if (barcode) {
      if (!isValidIndiaPostBarcode(barcode)) {
        rowIssues.push({
          orderNumber: serial,
          barcode,
          field: "barcode_no",
          value: barcode,
          error: "Barcode must be a valid unique S10 article number.",
          status: "Failed",
          category: "INDIA_POST_VALIDATION",
        });
      }
      if (seen.has(barcode) || used.has(barcode)) {
        rowIssues.push({
          orderNumber: serial,
          barcode,
          field: "barcode_no",
          value: barcode,
          error: "Duplicate barcode.",
          status: "Failed",
          category: "MAPPING",
        });
      }
      seen.add(barcode);
    }
    issues.push(...rowIssues);
    rows.push({
      orderNumber: serial,
      barcode,
      valid: rowIssues.length === 0,
      issues: rowIssues,
      status: rowIssues.length ? "INVALID" : "VALID",
    });
  }

  const valid = rows.filter((row) => row.valid).length;
  return {
    total: parsed.articles.length,
    valid,
    invalid: parsed.articles.length - valid,
    queued: 0,
    retrying: 0,
    processing: 0,
    booked: 0,
    failed: 0,
    labelsGenerated: 0,
    manifestEligible: 0,
    rows,
    issues,
  };
}

export async function queueExcelBuffer(supabase: SupabaseClient, ctx: TenantContext, bytes: ArrayBuffer) {
  const parsed = await parseIndiaPostBookingWorkbook(bytes);
  const validation = await validateExcelBuffer(supabase, ctx, bytes);
  const validSerials = new Set(validation.rows.filter((row) => row.valid).map((row) => row.orderNumber));
  const createdIds: string[] = [];
  const store = await loadStoreContext(supabase, ctx.organizationId);
  const serviceCode = resolveOrderBookingService({
    orderService: null,
    workspaceOverride: store.connection?.booking_service_override,
    defaultService: store.defaultService || DEFAULT_INDIA_POST_SERVICE,
    allowedServices: store.allowedServices,
  });

  for (const article of parsed.articles) {
    const serial = article.serial_number;
    if (!validSerials.has(serial)) continue;
    const weight = Number(article.physical_weight) || 0;
    const isCod = ["cod", "codr"].includes(article.codr_cod.trim().toLowerCase());
    const order = await createManualOrder(supabase, ctx, {
      customer: {
        name: article.receiver_name,
        phone: article.receiver_mobile_no,
        email: article.receiver_emailid || undefined,
      },
      shippingAddress: {
        name: article.receiver_name,
        phone: article.receiver_mobile_no,
        line1: article.receiver_add_line_1,
        line2: article.receiver_add_line_2 || undefined,
        city: article.receiver_city,
        state: article.receiver_state || article.receiver_city,
        pincode: article.receiver_pincode,
        country: "IN",
      },
      lineItems: [{ title: "Parcel", quantity: 1, unitPrice: Number(article.value_for_codr_cod) || 0, weightGrams: weight }],
      paymentStatus: isCod ? "COD" : "PAID",
      source: "MANUAL",
      orderNumber: `XL-${serial}`,
    });
    await supabase
      .from("orders")
      .update({ india_post_service: serviceCode, parcel_weight_mode: "manual", parcel_weight_grams: weight })
      .eq("id", order.id);
    const collect = shipmentCollectFromOrder({
      payment_status: isCod ? "COD" : "PAID",
      total_amount: Number(article.value_for_codr_cod) || 0,
      cod_amount: isCod ? Number(article.value_for_codr_cod) || 0 : 0,
    });
    let barcode = article.barcode_no.trim().toUpperCase();
    if (!barcode) {
      barcode = await allocateNextBarcode(supabase, {
        organizationId: ctx.organizationId,
        serviceCode,
        environment: store.connection?.environment,
      });
    }
    const { data: shipment, error } = await supabase
      .from("shipments")
      .insert({
        organization_id: ctx.organizationId,
        order_id: order.id,
        customer_id: order.customer_id,
        shipping_address_id: order.shipping_address_id,
        service_code: serviceCode,
        payment_mode: collect.payment_mode,
        cod_amount: collect.cod_amount,
        weight_grams: weight,
        length_cm: Number(article.length) || null,
        width_cm: Number(article.breadth_diameter) || null,
        height_cm: Number(article.height) || null,
        barcode,
        status: "QUEUED",
      })
      .select("id")
      .single();
    if (error || !shipment) {
      throw new AppError(ERROR_CODES.SHIPMENT_FAILED, error?.message || "Could not create shipment from Excel.");
    }
    createdIds.push(shipment.id);
  }

  const bookingJobs =
    effectiveIndiaPostBookingBatchSize() === 1
      ? await Promise.all(
          createdIds.map((entityId) =>
            createBackgroundJob(supabase, {
              organizationId: ctx.organizationId,
              jobType: "shipment-booking",
              entityType: "shipment",
              entityId,
              userId: ctx.userId,
            })
          )
        )
      : await enqueueQueuedShipmentsAsBulkOrSingle(supabase, ctx, createdIds);
  const { claimedJobFromRow, startQueuedBookingJobs } = await import("@/lib/jobs/drain");
  await startQueuedBookingJobs(bookingJobs.map(claimedJobFromRow));
  return { ...validation, queued: createdIds.length };
}
