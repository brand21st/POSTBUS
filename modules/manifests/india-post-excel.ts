import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { BOOKED_EXPORT_MAX, bookedShipmentRow } from "@/modules/booking-queue/export";
import { mapShipmentToArticle } from "@/modules/india-post/article-mapper";
import { isValidIndiaPostBarcode, validateIndiaPostArticle } from "@/modules/india-post/article-validator";
import { articleDetailsWorkbook } from "@/modules/india-post/article-details-sheet";
import { indiaPostBookingServiceCode, indiaPostMobile } from "@/modules/india-post/endpoints";
import { indiaPostRequiresOtp } from "@/modules/india-post/spec";
import { manifestFileBase } from "@/modules/manifests/export";
import { getManifest } from "@/modules/manifests/service";
import { organizationLabelSender, type OrganizationLabelSender } from "@/modules/organizations/label-sender";
import { DEFAULT_INDIA_POST_SERVICE } from "@/types/domain";

/** Booked articles that must not be written into an India Post workbook. */
export const MANIFEST_EXCEL_BLOCKED_STATUSES = ["CANCELLED", "FAILED", "RECOVERY_REQUIRED"] as const;

const FAILURE_PREVIEW = 12;

export type ManifestExcelShipment = {
  id: string;
  status?: string | null;
  booked_at?: string | null;
  barcode?: string | null;
  tracking_number?: string | null;
  service_code?: string | null;
  weight_grams?: number | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
  payment_mode?: string | null;
  cod_amount?: number | null;
  orderNumber?: string | null;
  address?: {
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

export type ManifestExcelContext = {
  sender: OrganizationLabelSender;
  senderCompany: string;
  customerId: string;
  officeId: string;
  contractByService: Map<string, string>;
  fallbackContractId: string;
};

export function indiaPostExcelFilename(manifest: Parameters<typeof manifestFileBase>[0]) {
  return `manifest_${manifestFileBase(manifest)}_india_post.xlsx`;
}

export function manifestExcelLabel(shipment: Pick<ManifestExcelShipment, "orderNumber" | "tracking_number" | "barcode" | "id">) {
  const barcode = (shipment.tracking_number || shipment.barcode || "").trim();
  return [shipment.orderNumber?.trim(), barcode].filter(Boolean).join(" · ") || shipment.id;
}

/** Why this shipment cannot be exported. Null when it can proceed to article validation. */
export function manifestExcelEligibilityError(shipment: ManifestExcelShipment): string | null {
  const status = String(shipment.status ?? "").toUpperCase();
  if (status === "CANCELLED") return "was cancelled";
  if (status === "FAILED") return "booking failed";
  if (status === "RECOVERY_REQUIRED") return "booking outcome is unresolved";
  if (!shipment.booked_at) return "is not a confirmed India Post booking";
  const barcode = (shipment.tracking_number || shipment.barcode || "").trim();
  if (!barcode) return "has no barcode";
  if (!isValidIndiaPostBarcode(barcode)) return "barcode is not a valid 13-character article number";
  return null;
}

export function manifestExcelArticleErrors(shipment: ManifestExcelShipment, context: ManifestExcelContext): string[] {
  const serviceCode = shipment.service_code || DEFAULT_INDIA_POST_SERVICE;
  const barcode = (shipment.tracking_number || shipment.barcode || "").trim().toUpperCase();
  const bookingService = indiaPostBookingServiceCode(serviceCode, barcode);
  const contractId = context.contractByService.get(bookingService) || context.fallbackContractId;
  const address = shipment.address ?? {};
  const draft = mapShipmentToArticle({
    orderNumber: shipment.orderNumber ?? undefined,
    shipmentId: shipment.id,
    serviceCode,
    customerId: context.customerId,
    contractId,
    barcode,
    officeId: context.officeId,
    originPin: context.sender.pincode || "",
    weightGrams: Number(shipment.weight_grams) || 0,
    lengthCm: shipment.length_cm,
    widthCm: shipment.width_cm,
    heightCm: shipment.height_cm,
    senderName: context.sender.name,
    senderCompany: context.senderCompany,
    senderLine1: context.sender.line1,
    senderLine2: context.sender.line2,
    senderCity: context.sender.city || "",
    senderState: context.sender.state || "",
    senderPin: context.sender.pincode || "",
    senderMobile: indiaPostMobile(context.sender.phone) || "",
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
    bulkReference: shipment.orderNumber ?? undefined,
  });
  return validateIndiaPostArticle({ ...draft, otp: indiaPostRequiresOtp(serviceCode) }).map((issue) => issue.error);
}

export function joinManifestExcelFailures(lines: string[]) {
  const shown = lines.slice(0, FAILURE_PREVIEW);
  const rest = lines.length - shown.length;
  const more = rest > 0 ? `\n…and ${rest} more.` : "";
  return `India Post Excel was not created. Fix these shipments and export again:\n${shown.join("\n")}${more}`;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

type LoadedShipment = {
  id: string;
  status?: string | null;
  booked_at?: string | null;
  barcode?: string | null;
  tracking_number?: string | null;
  service_code?: string | null;
  weight_grams?: number | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
  payment_mode?: string | null;
  cod_amount?: number | null;
  orders?: { order_number?: string | null } | Array<{ order_number?: string | null }> | null;
  addresses?: ManifestExcelShipment["address"] | Array<NonNullable<ManifestExcelShipment["address"]>> | null;
};

function asExcelShipment(row: LoadedShipment): ManifestExcelShipment {
  const order = one(row.orders);
  return {
    id: row.id,
    status: row.status,
    booked_at: row.booked_at,
    barcode: row.barcode,
    tracking_number: row.tracking_number,
    service_code: row.service_code,
    weight_grams: row.weight_grams,
    length_cm: row.length_cm,
    width_cm: row.width_cm,
    height_cm: row.height_cm,
    payment_mode: row.payment_mode,
    cod_amount: row.cod_amount,
    orderNumber: order?.order_number ?? null,
    address: one(row.addresses),
  };
}

/**
 * ArticleDetails workbook for one manifest. Reads booked shipment rows only.
 * Does not book, allocate barcodes, or change shipment or manifest status.
 */
export async function exportManifestIndiaPostExcel(supabase: SupabaseClient, organizationId: string, manifestId: string) {
  const manifest = await getManifest(supabase, organizationId, manifestId);
  const { count, error: countError } = await supabase
    .from("manifest_shipments")
    .select("shipment_id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("manifest_id", manifestId);
  if (countError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, countError.message);
  const total = count ?? manifest.lines.length;
  if (total < 1) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This manifest has no shipments to export.");
  }
  if (total > BOOKED_EXPORT_MAX) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `This manifest has ${total} shipments. Export at most ${BOOKED_EXPORT_MAX} at a time.`
    );
  }

  const { data: links, error: linkError } = await supabase
    .from("manifest_shipments")
    .select("shipment_id")
    .eq("organization_id", organizationId)
    .eq("manifest_id", manifestId)
    .order("added_at", { ascending: true });
  if (linkError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, linkError.message);
  const ids = (links ?? []).map((row) => String(row.shipment_id));

  const [{ data: org }, { data: pickup }, { data: shop }, { data: connection }, { data: contracts }] = await Promise.all([
    supabase.from("organizations").select("name, phone, line1, line2, city, state, pincode").eq("id", organizationId).maybeSingle(),
    supabase.from("pickup_locations").select("*").eq("organization_id", organizationId).order("is_default", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("shopify_stores").select("shop_name").eq("organization_id", organizationId).maybeSingle(),
    supabase
      .from("india_post_connections")
      .select("bulk_customer_id, contract_id, pickup_dropoff_office_id")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase.from("india_post_contracts").select("service_code, contract_id, is_active").eq("organization_id", organizationId),
  ]);

  const sender = organizationLabelSender(org, pickup, shop?.shop_name);
  const context: ManifestExcelContext = {
    sender,
    senderCompany: String(org?.name || pickup?.name || sender.name || ""),
    customerId: String(connection?.bulk_customer_id ?? "").trim(),
    officeId: String(connection?.pickup_dropoff_office_id ?? "").replace(/\D/g, ""),
    fallbackContractId: String(connection?.contract_id ?? "").trim(),
    contractByService: new Map(
      (contracts ?? [])
        .filter((row) => row.is_active !== false)
        .map((row) => [String(row.service_code), String(row.contract_id ?? "").trim()])
    ),
  };
  if (!/^\d{10}$/.test(context.customerId)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "India Post customer ID must be 10 digits. Save it on the India Post integration page."
    );
  }
  if (!/^\d{8}$/.test(context.officeId)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "India Post drop-off office ID must be 8 digits. Save it on the India Post integration page."
    );
  }

  const { data, error } = await supabase
    .from("shipments")
    .select(
      "id, status, booked_at, barcode, tracking_number, service_code, weight_grams, length_cm, width_cm, height_cm, payment_mode, cod_amount, orders(order_number), addresses:shipping_address_id(name, company_name, line1, line2, line3, city, state, pincode, phone, email)"
    )
    .eq("organization_id", organizationId)
    .in("id", ids);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const byId = new Map(((data ?? []) as unknown as LoadedShipment[]).map((row) => [row.id, row]));

  const failures: string[] = [];
  const rows = [];
  ids.forEach((id, index) => {
    const loaded = byId.get(id);
    if (!loaded) {
      failures.push(`${id}: shipment was not found in this workspace`);
      return;
    }
    const shipment = asExcelShipment(loaded);
    const label = manifestExcelLabel(shipment);
    const blocked = manifestExcelEligibilityError(shipment);
    if (blocked) {
      failures.push(`${label}: ${blocked}`);
      return;
    }
    const articleErrors = manifestExcelArticleErrors(shipment, context);
    if (articleErrors.length) {
      failures.push(`${label}: ${articleErrors[0]}`);
      return;
    }
    rows.push(
      bookedShipmentRow(
        {
          id: shipment.id,
          order_id: null,
          barcode: shipment.barcode ?? null,
          tracking_number: shipment.tracking_number ?? null,
          service_code: shipment.service_code ?? null,
          weight_grams: shipment.weight_grams ?? null,
          length_cm: shipment.length_cm ?? null,
          width_cm: shipment.width_cm ?? null,
          height_cm: shipment.height_cm ?? null,
          payment_mode: shipment.payment_mode ?? null,
          cod_amount: shipment.cod_amount ?? null,
          booked_at: shipment.booked_at || "",
          orders: { order_number: shipment.orderNumber ?? null },
          addresses: shipment.address ?? null,
        },
        context.sender,
        context.senderCompany,
        index + 1
      )
    );
  });

  if (failures.length) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, joinManifestExcelFailures(failures));
  }

  return {
    bytes: await articleDetailsWorkbook(rows),
    filename: indiaPostExcelFilename(manifest),
  };
}
