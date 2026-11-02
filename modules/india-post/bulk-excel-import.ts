import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import {
  BULK_EXCEL_BOOKING_DISABLED_MESSAGE,
  bulkExcelBookingEnabled,
} from "@/modules/india-post/booking-recovery";
import { writeWorkbook } from "@/lib/xlsx/write";
import { allocateNextBarcode } from "@/modules/india-post/allocate-barcode";
import { barcodePrefixAllowedForService } from "@/modules/india-post/barcode";
import {
  assessImportRows,
  canResumeBulkExcelBooking,
  canStartBulkExcelBooking,
  importRowsAwaitingShipment,
  type AssessedImportRow,
  type ImportStoreDefaults,
} from "@/modules/india-post/bulk-excel-validate";
import { countsFromShipments, startBookingForShipmentIds } from "@/modules/india-post/bulk-booking";
import { duplicateBarcodeBookingBlock, metadataWithFirstBarcodeProof } from "@/modules/india-post/booking-provenance";
import { resolveOrderBookingService } from "@/modules/india-post/booking-service";
import { savedParcelContracts } from "@/modules/india-post/contracts";
import { isImportFormat, MERCHANT_BOOKING_FIELDS, type ImportFormat } from "@/modules/india-post/excel-profiles";
import {
  BULK_EXCEL_MAX_BYTES,
  parseMerchantWorkbook,
  postbridgeTemplateWorkbook,
  remapMerchantRows,
} from "@/modules/india-post/merchant-excel";
import { resolveIndiaPostOrigin } from "@/modules/india-post/origin";
import { parcelDefaultsFromConnection } from "@/modules/india-post/parcel-defaults";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import { isIndiaPostAcceptedStatus } from "@/modules/india-post/booking-status";
import { createBackgroundJob } from "@/modules/jobs/service";
import { createManualOrder } from "@/modules/orders/service";
import { shipmentCollectFromOrder } from "@/modules/orders/payment";
import { organizationLabelSender } from "@/modules/organizations/label-sender";
import { retryShipment } from "@/modules/shipments/service";
import { DEFAULT_INDIA_POST_SERVICE, type MemberRole } from "@/types/domain";

const MATERIALIZE_CHUNK = 25;
const FIELD_KEYS = new Set(MERCHANT_BOOKING_FIELDS.map((field) => field.key));

type BatchRow = {
  id: string;
  organization_id: string;
  filename: string;
  profile_key: string;
  status: string;
  sheet_name: string | null;
  header_row: number | null;
  column_map: Record<string, string>;
  unmapped_headers: string[];
  headers: string[];
  other_sheets: string[];
  service_code: string | null;
  overrides: Record<string, unknown>;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  materialize_job_id: string | null;
  created_by: string | null;
};

type ImportRow = {
  id: string;
  batch_id: string;
  organization_id: string;
  excel_row_number: number;
  raw_cells: Record<string, string>;
  mapped_fields: Record<string, string>;
  unmapped: Record<string, string>;
  normalized: Record<string, unknown>;
  issues: unknown[];
  barcode: string | null;
  status: string;
  order_id: string | null;
  shipment_id: string | null;
};

function asRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) out[key] = item == null ? "" : String(item);
  return out;
}

function asStringList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function mapBatch(row: Record<string, unknown>): BatchRow {
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    filename: String(row.filename ?? ""),
    profile_key: String(row.profile_key ?? "postbridge"),
    status: String(row.status ?? ""),
    sheet_name: row.sheet_name ? String(row.sheet_name) : null,
    header_row: row.header_row == null ? null : Number(row.header_row),
    column_map: asRecord(row.column_map),
    unmapped_headers: asStringList(row.unmapped_headers),
    headers: asStringList(row.headers),
    other_sheets: asStringList(row.other_sheets),
    service_code: row.service_code ? String(row.service_code) : null,
    overrides: (row.overrides && typeof row.overrides === "object" ? row.overrides : {}) as Record<string, unknown>,
    total_rows: Number(row.total_rows ?? 0),
    valid_rows: Number(row.valid_rows ?? 0),
    invalid_rows: Number(row.invalid_rows ?? 0),
    materialize_job_id: row.materialize_job_id ? String(row.materialize_job_id) : null,
    created_by: row.created_by ? String(row.created_by) : null,
  };
}

function mapImportRow(row: Record<string, unknown>): ImportRow {
  return {
    id: String(row.id),
    batch_id: String(row.batch_id),
    organization_id: String(row.organization_id),
    excel_row_number: Number(row.excel_row_number),
    raw_cells: asRecord(row.raw_cells),
    mapped_fields: asRecord(row.mapped_fields),
    unmapped: asRecord(row.unmapped),
    normalized: (row.normalized && typeof row.normalized === "object" ? row.normalized : {}) as Record<string, unknown>,
    issues: Array.isArray(row.issues) ? row.issues : [],
    barcode: row.barcode ? String(row.barcode) : null,
    status: String(row.status ?? "pending"),
    order_id: row.order_id ? String(row.order_id) : null,
    shipment_id: row.shipment_id ? String(row.shipment_id) : null,
  };
}

async function loadBatch(supabase: SupabaseClient, organizationId: string, batchId: string) {
  const { data, error } = await supabase
    .from("bulk_import_batches")
    .select("*")
    .eq("id", batchId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Import batch was not found.");
  return mapBatch(data as Record<string, unknown>);
}

async function loadRows(supabase: SupabaseClient, organizationId: string, batchId: string) {
  const { data, error } = await supabase
    .from("bulk_import_rows")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("batch_id", batchId)
    .order("excel_row_number", { ascending: true });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return (data ?? []).map((row) => mapImportRow(row as Record<string, unknown>));
}

async function storeDefaults(
  supabase: SupabaseClient,
  organizationId: string,
  serviceCode: string
): Promise<ImportStoreDefaults> {
  const [{ data: connection }, { data: pickup }, { data: org }, { data: shop }, { data: contracts }, { data: ranges }, { data: shipments }] =
    await Promise.all([
      supabase.from("india_post_connections").select("*").eq("organization_id", organizationId).maybeSingle(),
      supabase.from("pickup_locations").select("*").eq("organization_id", organizationId).order("is_default", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("organizations").select("name, phone, line1, line2, city, state, pincode").eq("id", organizationId).maybeSingle(),
      supabase.from("shopify_stores").select("shop_name").eq("organization_id", organizationId).maybeSingle(),
      supabase.from("india_post_contracts").select("service_code, contract_id, is_active").eq("organization_id", organizationId),
      supabase.from("barcode_ranges").select("prefix, service_code, next_number, end_number, is_active").eq("organization_id", organizationId).eq("is_active", true),
      supabase.from("shipments").select("barcode").eq("organization_id", organizationId).not("barcode", "is", null),
    ]);
  if (!connection || connection.status === "NOT_CONNECTED") {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "India Post is not connected.");
  }
  const allowedServices = savedParcelContracts({
    contracts: (contracts ?? []).map((row) => ({
      serviceCode: String(row.service_code ?? ""),
      contractId: String(row.contract_id ?? ""),
      isActive: row.is_active !== false,
    })),
  }).map((contract) => contract.serviceCode);
  const contract = (contracts ?? []).find(
    (row) => row.is_active !== false && String(row.service_code) === serviceCode
  );
  const sender = organizationLabelSender(org, pickup, shop?.shop_name);
  let officeId = "";
  let originPin = sender.pincode || String(pickup?.pincode ?? "");
  try {
    const provider = indiaPostFromRow(connection);
    const origin = await resolveIndiaPostOrigin(provider, connection, pickup, originPin || "110001");
    officeId = origin.officeId;
    originPin = origin.pincode || originPin;
  } catch {
    officeId = "";
  }
  let allocatableBarcodes = 0;
  for (const range of ranges ?? []) {
    if (!barcodePrefixAllowedForService(String(range.prefix ?? ""), serviceCode)) continue;
    const next = Number(range.next_number);
    const end = Number(range.end_number);
    if (Number.isFinite(next) && Number.isFinite(end) && next <= end) allocatableBarcodes += end - next + 1;
  }
  return {
    serviceCode,
    allowedServices,
    customerId: String(connection.bulk_customer_id ?? ""),
    contractId: String(contract?.contract_id ?? connection.contract_id ?? ""),
    officeId,
    originPin,
    senderName: sender.name,
    senderCompany: org?.name || sender.name,
    senderLine1: sender.line1,
    senderLine2: sender.line2,
    senderCity: sender.city || "",
    senderState: sender.state || "",
    senderPin: sender.pincode || originPin,
    senderMobile: sender.phone || "",
    allocatableBarcodes,
    usedBarcodes: new Set((shipments ?? []).map((row) => String(row.barcode).toUpperCase())),
    parcelDefaults: parcelDefaultsFromConnection(connection),
  };
}

async function defaultService(supabase: SupabaseClient, organizationId: string) {
  const [{ data: connection }, { data: contracts }] = await Promise.all([
    supabase.from("india_post_connections").select("booking_service_override").eq("organization_id", organizationId).maybeSingle(),
    supabase.from("india_post_contracts").select("service_code, contract_id, is_active").eq("organization_id", organizationId),
  ]);
  const allowedServices = savedParcelContracts({
    contracts: (contracts ?? []).map((row) => ({
      serviceCode: String(row.service_code ?? ""),
      contractId: String(row.contract_id ?? ""),
      isActive: row.is_active !== false,
    })),
  }).map((contract) => contract.serviceCode);
  return resolveOrderBookingService({
    orderService: null,
    workspaceOverride: connection?.booking_service_override,
    defaultService: allowedServices[0] || DEFAULT_INDIA_POST_SERVICE,
    allowedServices,
  });
}

function previewRows(rows: ImportRow[]) {
  return rows.slice(0, 8).map(publicRow);
}

function publicRow(row: ImportRow) {
  const normalized = row.normalized;
  return {
    id: row.id,
    excelRowNumber: row.excel_row_number,
    status: row.status,
    barcode: row.barcode,
    orderId: row.order_id,
    shipmentId: row.shipment_id,
    mapped: row.mapped_fields,
    unmapped: row.unmapped,
    issues: row.issues,
    receiverName: String(normalized.receiverName ?? row.mapped_fields.receiver_name ?? ""),
    mobile: String(normalized.receiverPhone ?? row.mapped_fields.receiver_mobile_no ?? ""),
    pincode: String(normalized.pincode ?? row.mapped_fields.receiver_pincode ?? ""),
    reference: String(normalized.bulkReference ?? row.mapped_fields.bulk_reference ?? ""),
    weight: normalized.weightGrams ?? row.mapped_fields.physical_weight ?? "",
    codAmount: normalized.codAmount ?? row.mapped_fields.value_for_codr_cod ?? "",
  };
}

function publicBatch(batch: BatchRow, rows?: ImportRow[]) {
  return {
    id: batch.id,
    filename: batch.filename,
    profile: batch.profile_key,
    status: batch.status,
    sheetName: batch.sheet_name,
    headerRow: batch.header_row,
    headers: batch.headers,
    columnMap: batch.column_map,
    unmappedHeaders: batch.unmapped_headers,
    otherSheets: batch.other_sheets,
    serviceCode: batch.service_code,
    total: batch.total_rows,
    valid: batch.valid_rows,
    invalid: batch.invalid_rows,
    fields: MERCHANT_BOOKING_FIELDS,
    preview: rows ? previewRows(rows) : undefined,
    rows: rows ? rows.map(publicRow) : undefined,
  };
}

async function writeAssessed(supabase: SupabaseClient, stored: ImportRow[], assessed: AssessedImportRow[]) {
  const byRow = new Map(stored.map((row) => [row.excel_row_number, row]));
  for (let index = 0; index < assessed.length; index += 40) {
    const slice = assessed.slice(index, index + 40);
    await Promise.all(
      slice.map((row) => {
        const current = byRow.get(row.excelRowNumber);
        if (!current) return Promise.resolve();
        return supabase
          .from("bulk_import_rows")
          .update({
            mapped_fields: row.mapped,
            unmapped: row.unmapped,
            normalized: row.normalized,
            issues: row.issues,
            barcode: row.barcode || null,
            status: row.valid ? "valid" : "invalid",
          })
          .eq("id", current.id);
      })
    );
  }
}

export async function excelTemplateBytes() {
  return postbridgeTemplateWorkbook();
}

export async function listMappingProfiles(supabase: SupabaseClient, ctx: TenantContext) {
  const { data, error } = await supabase
    .from("bulk_import_mapping_profiles")
    .select("id, name, format_key, column_map")
    .eq("organization_id", ctx.organizationId)
    .order("name");
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    format: row.format_key,
    columnMap: asRecord(row.column_map),
  }));
}

export async function saveMappingProfile(
  supabase: SupabaseClient,
  ctx: TenantContext,
  input: { name: string; format: string; columnMap: Record<string, string> }
) {
  const name = input.name.trim();
  if (name.length < 2) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Profile name is required.");
  if (!isImportFormat(input.format)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unknown mapping format.");
  const { data, error } = await supabase
    .from("bulk_import_mapping_profiles")
    .upsert(
      {
        organization_id: ctx.organizationId,
        name,
        format_key: input.format,
        column_map: input.columnMap,
      },
      { onConflict: "organization_id,name" }
    )
    .select("id, name, format_key")
    .single();
  if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not save the mapping profile.");
  return { id: data.id, name: data.name, format: data.format_key };
}

export async function createImportBatch(
  supabase: SupabaseClient,
  ctx: TenantContext,
  bytes: ArrayBuffer,
  filename: string,
  savedProfileId?: string
) {
  if (bytes.byteLength > BULK_EXCEL_MAX_BYTES) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Excel file is larger than 8 MB.");
  }
  const parsed = await parseMerchantWorkbook(bytes);
  if (!parsed.rows.length) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, parsed.issues[0]?.error || "The workbook has no shipment rows.");
  }
  const overflow = parsed.issues.find((issue) => /maximum is/.test(issue.error));
  if (overflow) throw new AppError(ERROR_CODES.VALIDATION_ERROR, overflow.error);
  let columnMap = parsed.columnMap;
  let profile: ImportFormat = parsed.profile;
  if (savedProfileId) {
    const { data: saved } = await supabase
      .from("bulk_import_mapping_profiles")
      .select("format_key, column_map")
      .eq("id", savedProfileId)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (saved && isImportFormat(String(saved.format_key))) {
      profile = saved.format_key as ImportFormat;
      const savedMap = asRecord(saved.column_map);
      columnMap = { ...columnMap };
      for (const header of parsed.headers) {
        if (savedMap[header]) columnMap[header] = savedMap[header];
      }
    }
  }
  const remapped = remapMerchantRows(parsed, columnMap);
  const serviceCode = await defaultService(supabase, ctx.organizationId);
  const { data: batch, error } = await supabase
    .from("bulk_import_batches")
    .insert({
      organization_id: ctx.organizationId,
      filename: filename.slice(0, 180) || "upload.xlsx",
      profile_key: profile,
      status: "mapped",
      sheet_name: parsed.sheetName,
      header_row: parsed.headerRowNumber,
      column_map: remapped.columnMap,
      unmapped_headers: parsed.headers.filter((header) => !remapped.columnMap[header]),
      headers: parsed.headers,
      other_sheets: parsed.otherSheets,
      service_code: serviceCode,
      total_rows: remapped.rows.length,
      created_by: ctx.userId,
    })
    .select("*")
    .single();
  if (error || !batch) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not save the import.");
  const saved = mapBatch(batch as Record<string, unknown>);
  for (let index = 0; index < remapped.rows.length; index += 200) {
    const slice = remapped.rows.slice(index, index + 200);
    const { error: rowError } = await supabase.from("bulk_import_rows").insert(
      slice.map((row) => ({
        batch_id: saved.id,
        organization_id: ctx.organizationId,
        excel_row_number: row.excelRowNumber,
        raw_cells: row.raw,
        mapped_fields: row.mapped,
        unmapped: row.unmapped,
        status: "pending",
      }))
    );
    if (rowError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, rowError.message);
  }
  const rows = await loadRows(supabase, ctx.organizationId, saved.id);
  return publicBatch(saved, rows.slice(0, 8));
}

export async function getImportBatch(supabase: SupabaseClient, ctx: TenantContext, batchId: string) {
  const batch = await loadBatch(supabase, ctx.organizationId, batchId);
  const rows = await loadRows(supabase, ctx.organizationId, batchId);
  return { ...publicBatch(batch, rows), duplicateRows: rows.filter((row) => row.issues.some((issue) => JSON.stringify(issue).includes("Duplicate"))).length };
}

export async function updateImportMapping(
  supabase: SupabaseClient,
  ctx: TenantContext,
  batchId: string,
  input: { columnMap: Record<string, string>; serviceCode?: string; profile?: string }
) {
  const batch = await loadBatch(supabase, ctx.organizationId, batchId);
  if (batch.status === "booking" || batch.status === "completed") {
    throw new AppError(ERROR_CODES.CONFLICT, "This import is already booking.");
  }
  const rows = await loadRows(supabase, ctx.organizationId, batchId);
  const remapped = remapMerchantRows(
    { headers: batch.headers, rows: rows.map((row) => ({ excelRowNumber: row.excel_row_number, raw: row.raw_cells, mapped: row.mapped_fields, unmapped: row.unmapped })) },
    input.columnMap
  );
  if (input.serviceCode) {
    const { data: contracts } = await supabase
      .from("india_post_contracts")
      .select("service_code, contract_id, is_active")
      .eq("organization_id", ctx.organizationId);
    const allowed = savedParcelContracts({
      contracts: (contracts ?? []).map((row) => ({
        serviceCode: String(row.service_code ?? ""),
        contractId: String(row.contract_id ?? ""),
        isActive: row.is_active !== false,
      })),
    }).map((contract) => contract.serviceCode);
    if (!allowed.includes(input.serviceCode)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "That service is not on the connected contract.");
    }
  }
  const profile = input.profile && isImportFormat(input.profile) ? input.profile : batch.profile_key;
  const { error } = await supabase
    .from("bulk_import_batches")
    .update({
      column_map: remapped.columnMap,
      unmapped_headers: batch.headers.filter((header) => !remapped.columnMap[header]),
      profile_key: profile,
      service_code: input.serviceCode || batch.service_code,
      status: "mapped",
      valid_rows: 0,
      invalid_rows: 0,
    })
    .eq("id", batch.id)
    .eq("organization_id", ctx.organizationId);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const byNumber = new Map(remapped.rows.map((row) => [row.excelRowNumber, row]));
  for (let index = 0; index < rows.length; index += 40) {
    await Promise.all(
      rows.slice(index, index + 40).map((row) => {
        const next = byNumber.get(row.excel_row_number);
        return supabase
          .from("bulk_import_rows")
          .update({
            mapped_fields: next?.mapped ?? row.mapped_fields,
            unmapped: next?.unmapped ?? row.unmapped,
            issues: [],
            status: "pending",
            normalized: {},
          })
          .eq("id", row.id)
          .eq("organization_id", ctx.organizationId);
      })
    );
  }
  return getImportBatch(supabase, ctx, batchId);
}

export async function validateImportBatch(supabase: SupabaseClient, ctx: TenantContext, batchId: string) {
  const batch = await loadBatch(supabase, ctx.organizationId, batchId);
  if (batch.status === "booking" || batch.status === "completed") {
    throw new AppError(ERROR_CODES.CONFLICT, "This import is already booking.");
  }
  const serviceCode = batch.service_code || (await defaultService(supabase, ctx.organizationId));
  const defaults = await storeDefaults(supabase, ctx.organizationId, serviceCode);
  const rows = await loadRows(supabase, ctx.organizationId, batchId);
  const assessed = assessImportRows(
    rows.map((row) => ({
      excelRowNumber: row.excel_row_number,
      mapped: row.mapped_fields,
      unmapped: row.unmapped,
    })),
    defaults
  );
  await writeAssessed(supabase, rows, assessed.rows);
  const valid = assessed.rows.filter((row) => row.valid).length;
  await supabase
    .from("bulk_import_batches")
    .update({
      status: "validated",
      service_code: serviceCode,
      total_rows: assessed.rows.length,
      valid_rows: valid,
      invalid_rows: assessed.rows.length - valid,
    })
    .eq("id", batch.id)
    .eq("organization_id", ctx.organizationId);
  return getImportBatch(supabase, ctx, batchId);
}

export async function patchImportRow(
  supabase: SupabaseClient,
  ctx: TenantContext,
  batchId: string,
  rowId: string,
  fields: Record<string, string>
) {
  const batch = await loadBatch(supabase, ctx.organizationId, batchId);
  if (batch.status === "booking" || batch.status === "completed") {
    throw new AppError(ERROR_CODES.CONFLICT, "This import is already booking.");
  }
  const rows = await loadRows(supabase, ctx.organizationId, batchId);
  const row = rows.find((item) => item.id === rowId);
  if (!row) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Import row was not found.");
  const mapped = { ...row.mapped_fields };
  for (const [key, value] of Object.entries(fields)) {
    if (!FIELD_KEYS.has(key)) continue;
    mapped[key] = String(value ?? "");
  }
  const { error } = await supabase
    .from("bulk_import_rows")
    .update({ mapped_fields: mapped })
    .eq("id", row.id)
    .eq("organization_id", ctx.organizationId);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return validateImportBatch(supabase, ctx, batchId);
}

export async function saveImportDraft(supabase: SupabaseClient, ctx: TenantContext, batchId: string) {
  const batch = await loadBatch(supabase, ctx.organizationId, batchId);
  if (batch.status !== "validated" && batch.status !== "draft") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Validate the workbook before saving a draft.");
  }
  await supabase
    .from("bulk_import_batches")
    .update({ status: "draft" })
    .eq("id", batch.id)
    .eq("organization_id", ctx.organizationId);
  return getImportBatch(supabase, ctx, batchId);
}

async function ensureMaterializeJob(supabase: SupabaseClient, ctx: TenantContext, batch: BatchRow) {
  if (batch.materialize_job_id) {
    const { data: existing } = await supabase
      .from("background_jobs")
      .select("id, status")
      .eq("id", batch.materialize_job_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (existing && ["QUEUED", "RUNNING"].includes(String(existing.status))) {
      return { jobId: existing.id, resumed: true };
    }
  }
  const job = await createBackgroundJob(supabase, {
    organizationId: ctx.organizationId,
    jobType: "bulk-excel-import",
    entityType: "bulk_import_batch",
    entityId: batch.id,
    userId: ctx.userId || undefined,
  });
  await supabase
    .from("bulk_import_batches")
    .update({ materialize_job_id: job.id, status: "booking" })
    .eq("id", batch.id)
    .eq("organization_id", ctx.organizationId);
  return { jobId: job.id as string, resumed: false };
}

function assertBulkExcelBookingEnabled() {
  if (bulkExcelBookingEnabled()) return;
  throw new AppError(ERROR_CODES.CONFLICT, BULK_EXCEL_BOOKING_DISABLED_MESSAGE);
}

export async function confirmImportBatch(supabase: SupabaseClient, ctx: TenantContext, batchId: string) {
  assertBulkExcelBookingEnabled();
  const batch = await loadBatch(supabase, ctx.organizationId, batchId);
  if (canResumeBulkExcelBooking(batch.status)) {
    const job = await ensureMaterializeJob(supabase, ctx, batch);
    return { status: "booking", ...job, booked: false };
  }
  if (!canStartBulkExcelBooking(batch.status)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Validate the workbook before booking.");
  }
  if (batch.valid_rows < 1) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "There are no valid rows to book.");
  }
  const { data: claimed, error } = await supabase
    .from("bulk_import_batches")
    .update({ status: "booking" })
    .eq("id", batch.id)
    .eq("organization_id", ctx.organizationId)
    .in("status", ["validated", "draft"])
    .select("id")
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!claimed) {
    const current = await loadBatch(supabase, ctx.organizationId, batchId);
    if (!canResumeBulkExcelBooking(current.status)) {
      throw new AppError(ERROR_CODES.CONFLICT, "This import cannot be booked again.");
    }
  }
  const job = await ensureMaterializeJob(supabase, ctx, { ...batch, status: "booking" });
  return { status: "booking", ...job, booked: false };
}

function workerActor(organizationId: string, userId: string): TenantContext {
  return {
    userId,
    email: null,
    fullName: null,
    organizationId,
    organizationName: "",
    role: "OWNER" satisfies MemberRole,
    permissions: [],
  };
}

async function materializeRow(
  supabase: SupabaseClient,
  ctx: TenantContext,
  batch: BatchRow,
  row: ImportRow
) {
  const normalized = row.normalized;
  const serviceCode = batch.service_code || DEFAULT_INDIA_POST_SERVICE;
  const paymentMode = String(normalized.paymentMode ?? "PREPAID").toUpperCase() === "COD" ? "COD" : "PAID";
  const codAmount = Number(normalized.codAmount) || 0;
  let orderId = row.order_id;
  let customerId = "";
  let addressId = "";
  if (!orderId) {
    const order = await createManualOrder(supabase, ctx, {
      customer: {
        name: String(normalized.receiverName || "Receiver"),
        phone: String(normalized.receiverPhone || ""),
        email: String(normalized.receiverEmail || "") || undefined,
      },
      shippingAddress: {
        name: String(normalized.receiverName || "Receiver"),
        phone: String(normalized.receiverPhone || ""),
        line1: String(normalized.line1 || ""),
        line2: String(normalized.line2 || "") || undefined,
        city: String(normalized.city || ""),
        state: String(normalized.state || normalized.city || ""),
        pincode: String(normalized.pincode || ""),
        country: "IN",
      },
      lineItems: [
        {
          title: "Parcel",
          quantity: 1,
          unitPrice: paymentMode === "COD" ? codAmount : 0,
          weightGrams: Number(normalized.weightGrams) || 0,
        },
      ],
      paymentStatus: paymentMode,
      source: "MANUAL",
      orderNumber: String(normalized.bulkReference || "").trim() || `XL-${batch.id.slice(0, 8)}-${row.excel_row_number}`,
    });
    orderId = order.id;
    customerId = order.customer_id;
    addressId = order.shipping_address_id;
    await supabase
      .from("orders")
      .update({
        india_post_service: serviceCode,
        parcel_weight_mode: "manual",
        parcel_weight_grams: Number(normalized.weightGrams) || 0,
      })
      .eq("id", order.id)
      .eq("organization_id", ctx.organizationId);
    await supabase.from("bulk_import_rows").update({ order_id: order.id }).eq("id", row.id);
  } else {
    const { data: order } = await supabase
      .from("orders")
      .select("customer_id, shipping_address_id")
      .eq("id", orderId)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    customerId = String(order?.customer_id ?? "");
    addressId = String(order?.shipping_address_id ?? "");
  }
  let barcode = String(normalized.barcode || row.barcode || "").toUpperCase();
  if (!barcode) {
    const { data: connection } = await supabase
      .from("india_post_connections")
      .select("environment")
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    barcode = await allocateNextBarcode(supabase, {
      organizationId: ctx.organizationId,
      serviceCode,
      environment: connection?.environment,
    });
  }
  const { data: existingBarcode, error: existingBarcodeError } = await supabase
    .from("shipments")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("barcode", barcode)
    .limit(1)
    .maybeSingle();
  if (existingBarcodeError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, existingBarcodeError.message);
  const duplicateBarcode = duplicateBarcodeBookingBlock(existingBarcode);
  if (duplicateBarcode) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, duplicateBarcode);
  }
  const collect = shipmentCollectFromOrder({
    payment_status: paymentMode,
    total_amount: codAmount,
    cod_amount: paymentMode === "COD" ? codAmount : 0,
  });
  const shipmentId = randomUUID();
  const issuedAt = new Date().toISOString();
  const { data: shipment, error } = await supabase
    .from("shipments")
    .insert({
      id: shipmentId,
      organization_id: ctx.organizationId,
      order_id: orderId,
      customer_id: customerId,
      shipping_address_id: addressId,
      service_code: serviceCode,
      payment_mode: collect.payment_mode,
      cod_amount: collect.cod_amount,
      weight_grams: Number(normalized.weightGrams) || 0,
      length_cm: Number(normalized.lengthCm) || null,
      width_cm: Number(normalized.widthCm) || null,
      height_cm: Number(normalized.heightCm) || null,
      barcode,
      created_at: issuedAt,
      metadata: metadataWithFirstBarcodeProof(null, {
        shipmentId,
        organizationId: ctx.organizationId,
        barcode,
        issuedAt,
      }),
      status: "QUEUED",
    })
    .select("id")
    .single();
  if (error || !shipment) {
    throw new AppError(ERROR_CODES.SHIPMENT_FAILED, error?.message || "Could not create shipment from Excel.");
  }
  await supabase
    .from("bulk_import_rows")
    .update({ shipment_id: shipment.id, barcode, status: "queued", order_id: orderId })
    .eq("id", row.id);
  return shipment.id as string;
}

export async function materializeBulkExcelImport(
  supabase: SupabaseClient,
  organizationId: string,
  batchId: string,
  jobId: string
) {
  if (!bulkExcelBookingEnabled()) {
    return { remaining: 0, skipped: true, disabled: true as const };
  }
  const batch = await loadBatch(supabase, organizationId, batchId);
  if (batch.status !== "booking") return { remaining: 0 };
  const { data: locked } = await supabase
    .from("bulk_import_batches")
    .update({ materialize_job_id: jobId })
    .eq("id", batch.id)
    .or(`materialize_job_id.is.null,materialize_job_id.eq.${jobId}`)
    .select("id")
    .maybeSingle();
  if (!locked) return { remaining: 0, skipped: true };
  const rows = importRowsAwaitingShipment(await loadRows(supabase, organizationId, batchId));
  const ctx = workerActor(organizationId, batch.created_by || "");
  const chunk = rows.slice(0, MATERIALIZE_CHUNK);
  const shipmentIds: string[] = [];
  for (const row of chunk) {
    try {
      shipmentIds.push(await materializeRow(supabase, ctx, batch, row));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create the order.";
      await supabase
        .from("bulk_import_rows")
        .update({
          status: "failed",
          issues: [{ field: "booking", value: "", error: message, status: "Failed", category: "BOOKING" }],
        })
        .eq("id", row.id);
    }
  }
  if (shipmentIds.length) await startBookingForShipmentIds(supabase, ctx, shipmentIds);
  const remaining = rows.length - chunk.length;
  if (remaining > 0) {
    const job = await createBackgroundJob(supabase, {
      organizationId,
      jobType: "bulk-excel-import",
      entityType: "bulk_import_batch",
      entityId: batch.id,
      userId: ctx.userId || undefined,
    });
    await supabase.from("bulk_import_batches").update({ materialize_job_id: job.id }).eq("id", batch.id);
    return { remaining };
  }
  await supabase.from("bulk_import_batches").update({ status: "completed" }).eq("id", batch.id);
  return { remaining: 0 };
}

export async function importProgress(supabase: SupabaseClient, ctx: TenantContext, batchId: string) {
  const batch = await loadBatch(supabase, ctx.organizationId, batchId);
  const rows = await loadRows(supabase, ctx.organizationId, batchId);
  const shipmentIds = rows.map((row) => row.shipment_id).filter((id): id is string => Boolean(id));
  const { data: shipments } = shipmentIds.length
    ? await supabase
        .from("shipments")
        .select("id, status, last_error, last_error_code, barcode")
        .eq("organization_id", ctx.organizationId)
        .in("id", shipmentIds)
    : { data: [] };
  const byId = new Map((shipments ?? []).map((row) => [String(row.id), row]));
  const stats = countsFromShipments(shipments ?? []);
  const uncertain = (shipments ?? []).filter((row) => String(row.status).toUpperCase() === "RECOVERY_REQUIRED").length;
  return {
    ...publicBatch(batch),
    rows: rows.map((row) => {
      const shipment = row.shipment_id ? byId.get(row.shipment_id) : undefined;
      return {
        ...publicRow(row),
        shipmentStatus: shipment ? String(shipment.status) : row.shipment_id ? "QUEUED" : row.status,
        shipmentError: shipment?.last_error ? String(shipment.last_error) : "",
        retryable: String(shipment?.status ?? "").toUpperCase() === "FAILED",
      };
    }),
    ...stats,
    uncertain,
    pendingMaterialize: rows.filter((row) => row.status === "valid" && !row.shipment_id).length,
    labelShipmentIds: (shipments ?? [])
      .filter((row) => isIndiaPostAcceptedStatus(row.status))
      .map((row) => String(row.id)),
  };
}

export async function retryImportFailures(supabase: SupabaseClient, ctx: TenantContext, batchId: string) {
  assertBulkExcelBookingEnabled();
  const progress = await importProgress(supabase, ctx, batchId);
  const ids = progress.rows.filter((row) => row.retryable && row.shipmentId).map((row) => row.shipmentId as string);
  for (const id of ids) {
    await retryShipment(supabase, ctx, id);
  }
  return { retried: ids.length };
}

export async function importErrorWorkbook(supabase: SupabaseClient, ctx: TenantContext, batchId: string) {
  const batch = await loadBatch(supabase, ctx.organizationId, batchId);
  const rows = await loadRows(supabase, ctx.organizationId, batchId);
  const headers = [...batch.headers, "Excel row", "Errors"];
  const body = rows
    .filter((row) => row.status === "invalid" || (Array.isArray(row.issues) && row.issues.length > 0))
    .map((row) => {
      const errors = (row.issues as Array<{ error?: string }>)
        .map((issue) => issue.error)
        .filter(Boolean)
        .join("; ");
      return [...batch.headers.map((header) => row.raw_cells[header] ?? ""), row.excel_row_number, errors];
    });
  return writeWorkbook([{ name: "Errors", rows: [headers, ...body] }]);
}
