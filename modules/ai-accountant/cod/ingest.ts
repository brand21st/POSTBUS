import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { writeAccountingAudit } from "@/modules/ai-accountant/audit";
import { ensureChartOfAccounts } from "@/modules/ai-accountant/chart";
import { parseCodFile, type CodColumnMap, type CodExtractedRow } from "@/modules/ai-accountant/cod/parse";
import { codRemittanceEntry } from "@/modules/ai-accountant/ledger/posting-rules";
import { postEntry } from "@/modules/ai-accountant/ledger/post";
import { paiseFromNumeric } from "@/modules/ai-accountant/money";
import { istDate } from "@/modules/ai-accountant/period";
import { AI_ACCOUNTANT_BUCKET } from "@/modules/ai-accountant/receipts";

export const MAX_COD_REPORT_BYTES = 15 * 1024 * 1024;

export function sourceHash(bytes: Uint8Array | string) {
  return createHash("sha256").update(typeof bytes === "string" ? bytes : Buffer.from(bytes)).digest("hex");
}

export const columnMapSchema = z
  .object({
    article: z.number().int().min(0).max(200).optional(),
    cod: z.number().int().min(0).max(200).optional(),
    commission: z.number().int().min(0).max(200).optional(),
    net: z.number().int().min(0).max(200).optional(),
    date: z.number().int().min(0).max(200).optional(),
  })
  .strict();

export type ShipmentMatch = { id: string; order_id: string | null; cod_amount: string | number | null; status: string | null; payment_mode?: string | null };

/** Decides a reconciliation status for one remittance row. Pure. */
export function classifyRow(row: CodExtractedRow, shipment: ShipmentMatch | null, alreadyRemitted: boolean) {
  if (!shipment) return { status: "UNMATCHED", reason: "missing_shipment", expectedPaise: null as number | null };
  const expectedPaise = paiseFromNumeric(shipment.cod_amount);
  const status = String(shipment.status ?? "").toUpperCase();
  if (status.includes("CANCEL")) return { status: "UNMATCHED", reason: "cancelled_shipment", expectedPaise };
  if (alreadyRemitted) return { status: "NEEDS_REVIEW", reason: "duplicate_remittance", expectedPaise };
  if (status === "RTO") return { status: "NEEDS_REVIEW", reason: "rto_shipment", expectedPaise };
  if (String(shipment.payment_mode ?? "COD").toUpperCase() !== "COD") return { status: "NEEDS_REVIEW", reason: "prepaid_shipment", expectedPaise };
  if (row.codAmountPaise === expectedPaise) return { status: "RECONCILED", reason: null, expectedPaise };
  return { status: "NEEDS_REVIEW", reason: row.codAmountPaise < expectedPaise ? "short_remittance" : "excess_remittance", expectedPaise };
}

async function postRemittance(supabase: SupabaseClient, organizationId: string, rowId: string, row: CodExtractedRow, fallbackDate: string) {
  if (row.netAmountPaise + row.commissionPaise <= 0) return;
  try {
    await postEntry(
      supabase,
      organizationId,
      codRemittanceEntry({
        reportRowId: rowId,
        article: row.articleBarcode,
        entryDate: row.deliveredOn ?? fallbackDate,
        netPaise: Math.max(0, row.netAmountPaise),
        commissionPaise: row.commissionPaise,
      })
    );
  } catch (error) {
    logError("ai_accountant.cod_post_failed", { organizationId, rowId, message: error instanceof Error ? error.message : "unknown" });
  }
}

export async function previewCodReport(file: File, columnMap?: CodColumnMap | null) {
  if (file.size > MAX_COD_REPORT_BYTES) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "COD reports must be 15 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = await parseCodFile(bytes, file.name, columnMap);
  return { ...parsed, rows: parsed.rows.slice(0, 20), rowCount: parsed.rows.length };
}

export async function ingestCodReport(
  supabase: SupabaseClient,
  input: { organizationId: string; userId: string; file: File; columnMap?: CodColumnMap | null }
) {
  const { organizationId } = input;
  if (input.file.size > MAX_COD_REPORT_BYTES) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "COD reports must be 15 MB or smaller.");
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const hash = sourceHash(bytes);
  const { data: existing } = await supabase
    .from("cod_reports")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("source_hash", hash)
    .maybeSingle();
  if (existing) return { reportId: existing.id as string, duplicate: true, status: existing.status as string };

  let parsed;
  try {
    parsed = await parseCodFile(bytes, input.file.name, input.columnMap);
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not read this file. Upload the India Post COD report as XLSX, CSV or PDF.");
  }
  // One row per article per report; the last occurrence wins.
  const unique = [...new Map(parsed.rows.map((row) => [row.articleBarcode, row])).values()];

  const { data: report, error } = await supabase
    .from("cod_reports")
    .insert({
      organization_id: organizationId,
      file_name: input.file.name.slice(0, 200),
      source_hash: hash,
      format: parsed.format,
      column_map: parsed.columnMap,
      status: unique.length ? "EXTRACTED" : "NEEDS_REVIEW",
      row_count: unique.length,
      net_amount: unique.reduce((sum, row) => sum + row.netAmountPaise, 0) / 100,
      created_by: input.userId,
    })
    .select("id, created_at")
    .single();
  if (error || !report) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not store the COD report.");

  const fallbackDate = istDate(report.created_at as string);
  const rowIds = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 500) {
    const { data: inserted, error: rowError } = await supabase
      .from("cod_report_rows")
      .insert(
        unique.slice(i, i + 500).map((row) => ({
          organization_id: organizationId,
          report_id: report.id,
          article_barcode: row.articleBarcode,
          delivered_on: row.deliveredOn ?? null,
          cod_amount: row.codAmountPaise / 100,
          commission_amount: row.commissionPaise / 100,
          net_amount: row.netAmountPaise / 100,
        }))
      )
      .select("id, article_barcode");
    if (rowError) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not store COD report rows.");
    for (const row of inserted ?? []) rowIds.set(row.article_barcode, row.id);
  }

  const articles = unique.map((row) => row.articleBarcode);
  const shipments = new Map<string, ShipmentMatch>();
  for (let i = 0; i < articles.length; i += 300) {
    const batch = articles.slice(i, i + 300);
    const { data } = await supabase
      .from("shipments")
      .select("id, order_id, cod_amount, status, payment_mode, barcode, tracking_number")
      .eq("organization_id", organizationId)
      .or(`barcode.in.(${batch.join(",")}),tracking_number.in.(${batch.join(",")})`);
    for (const row of data ?? []) {
      if (row.barcode) shipments.set(String(row.barcode).toUpperCase(), row);
      if (row.tracking_number) shipments.set(String(row.tracking_number).toUpperCase(), row);
    }
  }
  const shipmentIds = [...new Set([...shipments.values()].map((s) => s.id))];
  const remitted = new Set<string>();
  for (let i = 0; i < shipmentIds.length; i += 500) {
    const { data } = await supabase
      .from("cod_reconciliations")
      .select("shipment_id")
      .eq("organization_id", organizationId)
      .eq("status", "RECONCILED")
      .in("shipment_id", shipmentIds.slice(i, i + 500));
    for (const row of data ?? []) remitted.add(row.shipment_id);
  }

  const reconciliations = [];
  let matched = 0;
  await ensureChartOfAccounts(supabase, organizationId);
  for (const row of unique) {
    const rowId = rowIds.get(row.articleBarcode);
    if (!rowId) continue;
    const shipment = shipments.get(row.articleBarcode) ?? null;
    const result = classifyRow(row, shipment, Boolean(shipment && remitted.has(shipment.id)));
    if (result.status === "RECONCILED") {
      matched += 1;
      await postRemittance(supabase, organizationId, rowId, row, fallbackDate);
    }
    reconciliations.push({
      organization_id: organizationId,
      report_row_id: rowId,
      shipment_id: shipment?.id ?? null,
      order_id: shipment?.order_id ?? null,
      status: result.status,
      expected_cod: result.expectedPaise === null ? null : result.expectedPaise / 100,
      reported_cod: row.codAmountPaise / 100,
      variance: result.expectedPaise === null ? null : (row.codAmountPaise - result.expectedPaise) / 100,
      reason: result.reason,
    });
  }
  for (let i = 0; i < reconciliations.length; i += 500) {
    await supabase.from("cod_reconciliations").insert(reconciliations.slice(i, i + 500));
  }
  await supabase
    .from("cod_reports")
    .update({ matched_count: matched, status: unique.length && matched === unique.length ? "RECONCILED" : unique.length ? "EXTRACTED" : "NEEDS_REVIEW" })
    .eq("id", report.id);

  const { error: uploadError } = await supabase.storage
    .from(AI_ACCOUNTANT_BUCKET)
    .upload(`${organizationId}/cod/${report.id}.${parsed.format.toLowerCase()}`, bytes, {
      upsert: true,
      contentType: "application/octet-stream",
    });
  if (uploadError) logError("ai_accountant.cod_upload_failed", { organizationId, reportId: report.id, message: uploadError.message });

  await writeAccountingAudit(supabase, {
    organizationId,
    actorId: input.userId,
    action: "cod_report.ingested",
    targetType: "cod_report",
    targetId: report.id,
    metadata: { rows: unique.length, matched, format: parsed.format },
  });
  return { reportId: report.id as string, duplicate: false, format: parsed.format, rows: unique.length, matched, warnings: parsed.warnings };
}

export async function listCodReports(supabase: SupabaseClient, organizationId: string, status?: string | null) {
  let recon = supabase
    .from("cod_reconciliations")
    .select("id, status, expected_cod, reported_cod, variance, reason, shipment_id, order_id, resolution_note, created_at, cod_report_rows(article_barcode, delivered_on, commission_amount, net_amount)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) recon = recon.eq("status", status);
  const [{ data: reports }, { data: rows }, { data: counts }] = await Promise.all([
    supabase
      .from("cod_reports")
      .select("id, file_name, status, format, row_count, matched_count, net_amount, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(50),
    recon,
    supabase.from("cod_reconciliations").select("status").eq("organization_id", organizationId).limit(20000),
  ]);
  const summary: Record<string, number> = {};
  for (const row of counts ?? []) summary[row.status] = (summary[row.status] ?? 0) + 1;
  return { reports: reports ?? [], reconciliations: rows ?? [], summary };
}

export const resolveSchema = z.object({
  status: z.enum(["RECONCILED", "WRITTEN_OFF", "UNMATCHED"]),
  note: z.string().trim().min(3).max(500),
});

/** Manual decision on a review-queue row. Reconciling posts the remittance. */
export async function resolveReconciliation(
  supabase: SupabaseClient,
  organizationId: string,
  id: string,
  raw: unknown,
  userId: string
) {
  const body = resolveSchema.parse(raw);
  const { data: recon } = await supabase
    .from("cod_reconciliations")
    .select("id, status, report_row_id, created_at")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (!recon) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Reconciliation row not found.");
  if (recon.status === "RECONCILED") throw new AppError(ERROR_CODES.CONFLICT, "This row is already reconciled.");
  await supabase
    .from("cod_reconciliations")
    .update({ status: body.status, resolution_note: body.note, resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", id);
  if (body.status === "RECONCILED") {
    const { data: row } = await supabase
      .from("cod_report_rows")
      .select("id, article_barcode, delivered_on, cod_amount, commission_amount, net_amount")
      .eq("organization_id", organizationId)
      .eq("id", recon.report_row_id)
      .maybeSingle();
    if (row) {
      await ensureChartOfAccounts(supabase, organizationId);
      await postRemittance(
        supabase,
        organizationId,
        row.id,
        {
          articleBarcode: row.article_barcode,
          deliveredOn: row.delivered_on,
          codAmountPaise: paiseFromNumeric(row.cod_amount),
          commissionPaise: paiseFromNumeric(row.commission_amount),
          netAmountPaise: paiseFromNumeric(row.net_amount),
        },
        istDate(recon.created_at as string)
      );
    }
  }
  await writeAccountingAudit(supabase, {
    organizationId,
    actorId: userId,
    action: "cod_reconciliation.resolved",
    targetType: "cod_reconciliation",
    targetId: id,
    metadata: { status: body.status },
  });
  return { id, status: body.status };
}
