import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { queueSourceOf } from "@/modules/booking-queue/eligibility";
import { assertBookingQueueEnabled, searchTargets } from "@/modules/booking-queue/service";
import { mapShipmentToArticle } from "@/modules/india-post/article-mapper";
import {
  articleDetailsFilename,
  articleDetailsParts,
  articleDetailsRow,
  articleDetailsWorkbook,
  indiaDate,
  normalizeExcelBookingLimit,
} from "@/modules/india-post/article-details-sheet";
import { indiaPostMobile } from "@/modules/india-post/endpoints";
import { indiaPostRequiresOtp } from "@/modules/india-post/spec";
import { organizationLabelSender } from "@/modules/organizations/label-sender";
import { DEFAULT_INDIA_POST_SERVICE } from "@/types/domain";

/** One export never reads more than India Post's largest file. */
export const BOOKED_EXPORT_MAX = 5000;

export type BookedExportQuery = {
  shipmentIds?: string[];
  search?: string;
  source?: string;
  from?: string;
  to?: string;
};

type ExportShipment = {
  id: string;
  order_id: string | null;
  barcode: string | null;
  tracking_number: string | null;
  service_code: string | null;
  weight_grams: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  payment_mode: string | null;
  cod_amount: number | null;
  booked_at: string;
  orders?: { order_number?: string | null; source?: string | null } | null;
  addresses?: {
    name?: string | null;
    company_name?: string | null;
    line1?: string | null;
    line2?: string | null;
    line3?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
};

const EXPORT_SELECT =
  "id, order_id, barcode, tracking_number, service_code, weight_grams, length_cm, width_cm, height_cm, payment_mode, cod_amount, booked_at, " +
  "orders(order_number, source), addresses:shipping_address_id(name, company_name, line1, line2, line3, city, state, pincode, phone, email)";

type Sender = ReturnType<typeof organizationLabelSender>;

/**
 * One ArticleDetails row for a shipment India Post booked. Built the way runIndiaPostBooking builds
 * the booking request, from stored data only: the barcode is the booked article number.
 */
export function bookedShipmentRow(shipment: ExportShipment, sender: Sender, senderCompany: string, serial: number) {
  const serviceCode = shipment.service_code || DEFAULT_INDIA_POST_SERVICE;
  const address = shipment.addresses ?? {};
  const draft = mapShipmentToArticle({
    orderId: shipment.order_id ?? undefined,
    orderNumber: shipment.orders?.order_number ?? undefined,
    shipmentId: shipment.id,
    serviceCode,
    customerId: "",
    contractId: "",
    barcode: (shipment.tracking_number || shipment.barcode || "").toUpperCase(),
    officeId: "",
    originPin: sender.pincode || "",
    weightGrams: Number(shipment.weight_grams) || 0,
    lengthCm: shipment.length_cm,
    widthCm: shipment.width_cm,
    heightCm: shipment.height_cm,
    senderName: sender.name,
    senderCompany,
    senderLine1: sender.line1,
    senderLine2: sender.line2,
    senderCity: sender.city || "",
    senderState: sender.state || "",
    senderPin: sender.pincode || "",
    senderMobile: indiaPostMobile(sender.phone) || "",
    receiverName: address.name ?? "",
    receiverCompany: address.company_name || address.name || "",
    receiverLine1: address.line1 ?? "",
    receiverLine2: address.line2 ?? "",
    receiverLine3: address.line3 ?? "",
    receiverCity: address.city ?? "",
    receiverState: address.state ?? "",
    receiverPin: address.pincode ?? "",
    receiverMobile: indiaPostMobile(address.phone) || "",
    receiverEmail: address.email ?? undefined,
    paymentMode: shipment.payment_mode,
    codAmount: Number(shipment.cod_amount) || 0,
    bulkReference: shipment.orders?.order_number ?? undefined,
  });
  return articleDetailsRow({ ...draft, otp: indiaPostRequiresOtp(serviceCode) }, serial);
}

async function loadBookedShipments(supabase: SupabaseClient, ctx: TenantContext, query: BookedExportQuery) {
  let request = supabase
    .from("shipments")
    .select(EXPORT_SELECT)
    .eq("organization_id", ctx.organizationId)
    .not("booked_at", "is", null);
  const ids = [...new Set((query.shipmentIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
  if (ids.length) {
    if (ids.length > BOOKED_EXPORT_MAX) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Export at most ${BOOKED_EXPORT_MAX} shipments at a time.`);
    }
    request = request.in("id", ids);
  } else {
    if (query.from) request = request.gte("booked_at", query.from);
    if (query.to) request = request.lte("booked_at", query.to);
    if (query.search?.trim()) {
      const targets = await searchTargets(supabase, ctx.organizationId, query.search);
      if (targets) {
        const clauses = [
          targets.orderIds.length ? `order_id.in.(${targets.orderIds.join(",")})` : "",
          targets.shipmentIds.length ? `id.in.(${targets.shipmentIds.join(",")})` : "",
        ].filter(Boolean);
        if (!clauses.length) return [];
        request = request.or(clauses.join(","));
      }
    }
  }
  const { data, error } = await request.order("booked_at", { ascending: true }).limit(BOOKED_EXPORT_MAX + 1);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const rows = (data ?? []) as unknown as ExportShipment[];
  if (rows.length > BOOKED_EXPORT_MAX) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `More than ${BOOKED_EXPORT_MAX} booked shipments match. Narrow the dates or search and export again.`
    );
  }
  // Source filter after loading: Excel imports are a queue source, not an order source.
  if (query.source && query.source !== "all") {
    const wanted = queueSourceOf(query.source);
    if (wanted !== "EXCEL") return rows.filter((row) => queueSourceOf(row.orders?.source) === wanted);
    const { data: excel } = await supabase
      .from("booking_queue_items")
      .select("shipment_id")
      .eq("organization_id", ctx.organizationId)
      .eq("source", "EXCEL")
      .in("shipment_id", rows.map((row) => row.id));
    const excelIds = new Set((excel ?? []).map((row) => String(row.shipment_id)));
    return rows.filter((row) => excelIds.has(row.id));
  }
  return rows;
}

async function exportContext(supabase: SupabaseClient, organizationId: string) {
  const [{ data: org }, { data: pickup }, { data: shop }, { data: connection }] = await Promise.all([
    supabase.from("organizations").select("name, phone, line1, line2, city, state, pincode").eq("id", organizationId).maybeSingle(),
    supabase
      .from("pickup_locations")
      .select("*")
      .eq("organization_id", organizationId)
      .order("is_default", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("shopify_stores").select("shop_name").eq("organization_id", organizationId).maybeSingle(),
    supabase.from("india_post_connections").select("*").eq("organization_id", organizationId).maybeSingle(),
  ]);
  const sender = organizationLabelSender(org, pickup, shop?.shop_name);
  return {
    sender,
    senderCompany: String(org?.name || pickup?.name || sender.name || ""),
    storeName: String(org?.name || shop?.shop_name || "store"),
    limit: normalizeExcelBookingLimit((connection as { excel_booking_limit?: unknown } | null)?.excel_booking_limit),
  };
}

async function prepareBookedExport(supabase: SupabaseClient, ctx: TenantContext, query: BookedExportQuery) {
  assertBookingQueueEnabled(ctx);
  const [shipments, context] = await Promise.all([
    loadBookedShipments(supabase, ctx, query),
    exportContext(supabase, ctx.organizationId),
  ]);
  if (!shipments.length) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "No booked shipments match this export.");
  const rows = shipments.map((shipment, index) => bookedShipmentRow(shipment, context.sender, context.senderCompany, index + 1));
  const date = indiaDate();
  const parts = articleDetailsParts(rows.length, context.limit).map((part, _index, all) => ({
    ...part,
    filename: articleDetailsFilename({ count: part.count, storeName: context.storeName, date, part: part.part, parts: all.length }),
  }));
  return { rows, parts, limit: context.limit };
}

/** Which files an export will produce, without building them. */
export async function bookedArticleDetailsPlan(supabase: SupabaseClient, ctx: TenantContext, query: BookedExportQuery) {
  const prepared = await prepareBookedExport(supabase, ctx, query);
  return { total: prepared.rows.length, limit: prepared.limit, parts: prepared.parts };
}

/**
 * Booked shipments as India Post ArticleDetails workbooks, split by the workspace's rows-per-file
 * limit. Only shipments with a confirmed booking (booked_at) are exported, so every barcode is a
 * real booked article. Operational data (queue state, batch, errors) is never written to the file.
 */
export async function bookedArticleDetailsExport(
  supabase: SupabaseClient,
  ctx: TenantContext,
  query: BookedExportQuery & { part?: number }
) {
  const { rows, parts } = await prepareBookedExport(supabase, ctx, query);
  const wanted = Math.max(1, Math.floor(Number(query.part) || 1));
  const part = parts.find((item) => item.part === wanted);
  if (!part) throw new AppError(ERROR_CODES.VALIDATION_ERROR, `File ${wanted} does not exist for this export.`);
  return {
    bytes: await articleDetailsWorkbook(rows.slice(part.from - 1, part.to)),
    filename: part.filename,
    parts,
    total: rows.length,
  };
}
