import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { renderCustomShippingLabel } from "@/modules/labels/custom-label-service";
import { persistLabelPdf } from "@/modules/labels/persist";
import { insertLabelSheetMembers, type LabelSheetMember } from "@/modules/labels/sheet-members";
import { MAX_LABELS } from "@/modules/labels/multi-up/request";
import { mapPool } from "@/modules/labels/multi-up/map-pool";
import { printMediaForPage } from "@/modules/labels/page-presets";
import { getLabelTemplate } from "@/modules/labels/template-service";
import { defaultLabelTemplateId } from "@/modules/labels/template-schema";
import { enqueueManualPrintJob, getPrintStation } from "@/modules/print/service";
import { queuedPrintMessage } from "@/modules/print/queued-message";

const PDF_RENDER_CONCURRENCY = 3;
const SIZE_TOLERANCE_PT = 1;

export function parseBulkPrintIds(ids: unknown) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
}

export async function mergeSameSizePdfs(pdfs: Uint8Array[]) {
  if (!pdfs.length) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Select shipping slips to print.");
  }
  const output = await PDFDocument.create();
  let expected: { width: number; height: number } | null = null;
  for (const bytes of pdfs) {
    const source = await PDFDocument.load(bytes);
    if (source.getPageCount() < 1) {
      throw new AppError(ERROR_CODES.LABEL_GENERATION_FAILED, "A shipping slip PDF has no pages.");
    }
    for (let index = 0; index < source.getPageCount(); index += 1) {
      const page = source.getPage(index);
      const width = page.getWidth();
      const height = page.getHeight();
      if (!expected) {
        expected = { width, height };
      } else if (
        Math.abs(width - expected.width) > SIZE_TOLERANCE_PT ||
        Math.abs(height - expected.height) > SIZE_TOLERANCE_PT
      ) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          "Selected slips are not the same paper size. Print them separately or use the same shipping template."
        );
      }
    }
    const copied = await output.copyPages(source, source.getPageIndices());
    for (const page of copied) output.addPage(page);
  }
  return {
    pdf: await output.save(),
    widthPt: expected?.width ?? 0,
    heightPt: expected?.height ?? 0,
    pageCount: output.getPageCount(),
  };
}

export async function prepareBulkShippingSlips(
  supabase: SupabaseClient,
  ctx: TenantContext,
  ids: string[]
) {
  if (!ids.length) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Select shipping slips to print.");
  }
  if (ids.length > MAX_LABELS) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Print at most ${MAX_LABELS} slips at a time.`);
  }

  const { data: selected, error: selectedError } = await supabase
    .from("labels")
    .select("id, shipment_id")
    .eq("organization_id", ctx.organizationId)
    .in("id", ids);
  if (selectedError) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, selectedError.message);
  }
  const byLabelId = new Map((selected ?? []).map((row) => [String(row.id), String(row.shipment_id || "")]));
  if (ids.some((id) => !byLabelId.has(id))) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Select shipping slips to print.");
  }
  const seen = new Set<string>();
  const shipmentIds: string[] = [];
  for (const id of ids) {
    const shipmentId = byLabelId.get(id) || "";
    if (!shipmentId || seen.has(shipmentId)) continue;
    seen.add(shipmentId);
    shipmentIds.push(shipmentId);
  }
  if (!shipmentIds.length) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Select shipping slips to print.");
  }
  if (shipmentIds.length > MAX_LABELS) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Print at most ${MAX_LABELS} slips at a time.`);
  }

  const { data: shipments } = await supabase
    .from("shipments")
    .select("id, barcode, booked_at")
    .eq("organization_id", ctx.organizationId)
    .in("id", shipmentIds);
  const { data: official } = await supabase
    .from("labels")
    .select("id, shipment_id")
    .eq("organization_id", ctx.organizationId)
    .eq("kind", "INDIA_POST")
    .eq("status", "READY")
    .in("shipment_id", shipmentIds);
  const officialByShipment = new Set((official ?? []).map((row) => String(row.shipment_id)));
  const shipmentById = new Map((shipments ?? []).map((row) => [String(row.id), row]));
  for (const shipmentId of shipmentIds) {
    const shipment = shipmentById.get(shipmentId);
    if (!shipment?.barcode || !shipment.booked_at || !officialByShipment.has(shipmentId)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Generate the India Post label first.");
    }
  }

  const stored = await getLabelTemplate(supabase, ctx.organizationId);
  const templateId = defaultLabelTemplateId(stored);
  const rendered = await mapPool(shipmentIds, PDF_RENDER_CONCURRENCY, (shipmentId) =>
    renderCustomShippingLabel(supabase, ctx.organizationId, { shipmentId, templateId })
  );
  const merged = await mergeSameSizePdfs(rendered.map((row) => new Uint8Array(row.pdf)));
  const first = rendered[0];
  if (!first) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Select shipping slips to print.");
  }
  return { merged, rendered, shipmentIds, first };
}

export async function printBulkShippingSlips(
  supabase: SupabaseClient,
  ctx: TenantContext,
  ids: string[],
  options?: { idempotencyKey?: string | null }
) {
  const { merged, rendered, shipmentIds, first } = await prepareBulkShippingSlips(supabase, ctx, ids);
  const members: LabelSheetMember[] = rendered.map((row) => ({
    orderId: row.orderId || row.shipmentId,
    shipmentId: row.shipmentId,
    orderUuid: row.orderId || row.shipmentId,
  }));
  const saved = await persistLabelPdf(supabase, {
    organizationId: ctx.organizationId,
    shipmentId: first.shipmentId,
    kind: "CUSTOM_SHIPPING",
    bytes: merged.pdf,
    templateSnapshot: first.template,
  });
  await insertLabelSheetMembers(supabase, {
    organizationId: ctx.organizationId,
    labelId: saved.id,
    members,
  });
  const media = printMediaForPage(first.template.page);
  const job = await enqueueManualPrintJob(supabase, ctx, saved.id, {
    paperSize: media.paperSize,
    copies: 1,
    idempotencyKey: options?.idempotencyKey,
  });
  const station = await getPrintStation(supabase, ctx.organizationId);
  return {
    labelId: saved.id,
    pageCount: merged.pageCount,
    job: { id: job.id, status: job.status, source: job.source, paperSize: media.paperSize, delivery: job.delivery },
    connected: station.connected,
    downloadPath: `/api/v1/labels/${saved.id}/download`,
    slipCount: shipmentIds.length,
    message: queuedPrintMessage({ connected: station.connected, delivery: job.delivery }),
  };
}
