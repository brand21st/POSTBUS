import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { loadCustomShippingLabel } from "@/modules/labels/custom-label-service";
import { renderMerchantLabelPdf } from "@/modules/labels/packing-pdf";
import { persistLabelPdf } from "@/modules/labels/persist";
import { insertLabelSheetMembers, type LabelSheetMember } from "@/modules/labels/sheet-members";
import { enqueueManualPrintJob, getPrintStation } from "@/modules/print/service";
import { multiUpPrintEnabled } from "@/modules/labels/multi-up/flag";
import {
  claimMultiSheetPrintKey,
  releaseMultiSheetPrintKey,
  storeMultiSheetPrintKey,
  type MultiSheetPrintResult,
} from "@/modules/labels/multi-up/idempotency";
import { applyPlacementOverrides, calculateMultiUpLayout } from "@/modules/labels/multi-up/layout";
import { mapPool } from "@/modules/labels/multi-up/map-pool";
import { composeMultiUpPdf } from "@/modules/labels/multi-up/pdf";
import { multiUpPrintDecision } from "@/modules/labels/multi-up/print";
import { labelSizeMm, parseMultiUpRequest } from "@/modules/labels/multi-up/request";
import { getLabelTemplate } from "@/modules/labels/template-service";
import { selectLabelTemplate, type LabelTemplate } from "@/modules/labels/template-schema";

const PDF_RENDER_CONCURRENCY = 3;

function sheetSnapshot(template: LabelTemplate, page: LabelTemplate["page"]): LabelTemplate {
  return { ...template, page };
}

export async function renderMultiUpSheet(
  supabase: SupabaseClient,
  organizationId: string,
  body: unknown
) {
  if (!multiUpPrintEnabled()) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Multi-up printing is turned off.");
  }
  const request = parseMultiUpRequest(body);
  const stored = await getLabelTemplate(supabase, organizationId);
  const template = selectLabelTemplate(stored, request.templateId);
  const templateSize = labelSizeMm(template.page);
  const labelWidthMm = request.sheet.labelWidthMm ?? templateSize.widthMm;
  const labelHeightMm = request.sheet.labelHeightMm ?? templateSize.heightMm;
  const calculated = calculateMultiUpLayout({
    sheetWidthMm: request.sheet.widthMm,
    sheetHeightMm: request.sheet.heightMm,
    labelWidthMm,
    labelHeightMm,
    margins: request.sheet.margins,
    gaps: request.sheet.gaps,
    rotation: request.sheet.rotation,
    scale: request.sheet.scale,
    columns: request.sheet.columns,
    rows: request.sheet.rows,
    items: request.items,
  });
  if (!calculated.ok) throw new AppError(ERROR_CODES.VALIDATION_ERROR, calculated.message);
  const layout = applyPlacementOverrides(calculated, request.sheet.placements);

  const uniqueOrderIds = [...new Set(request.items.map((item) => item.orderId))];
  const loadedRows = await mapPool(uniqueOrderIds, PDF_RENDER_CONCURRENCY, async (orderId) => {
    const loaded = await loadCustomShippingLabel(supabase, organizationId, {
      orderId,
      templateId: request.templateId,
    });
    const pdf = await renderMerchantLabelPdf(loaded.template, loaded.data);
    return {
      orderId,
      shipmentId: loaded.shipmentId,
      orderUuid: loaded.orderId,
      pdf,
    };
  });

  const pdfs = new Map<string, Uint8Array>();
  const members: LabelSheetMember[] = [];
  for (const row of loadedRows) {
    pdfs.set(row.orderId, row.pdf);
    members.push({ orderId: row.orderId, shipmentId: row.shipmentId, orderUuid: row.orderUuid });
  }
  const shipmentId = members[0]?.shipmentId || "";
  const pdf = await composeMultiUpPdf(
    layout,
    layout.placements.map((placement) => {
      const bytes = pdfs.get(placement.orderId);
      if (!bytes) throw new AppError(ERROR_CODES.LABEL_GENERATION_FAILED, "A label PDF is missing.");
      return bytes;
    })
  );
  return { request, template, layout, pdf, shipmentId, members };
}

export async function printMultiUpSheet(
  supabase: SupabaseClient,
  ctx: TenantContext,
  body: unknown,
  options?: { idempotencyKey?: string | null }
) {
  const claimed = await claimMultiSheetPrintKey(supabase, ctx.organizationId, options?.idempotencyKey);
  if (claimed?.cached) return claimed.cached;
  try {
    const rendered = await renderMultiUpSheet(supabase, ctx.organizationId, body);
    const station = await getPrintStation(supabase, ctx.organizationId);
    const decision = multiUpPrintDecision({
      sheetPaper: rendered.request.sheet.paperSize,
      agentPaper: station.paperSize,
      connected: station.connected,
    });
    if (!decision.ok) throw new AppError(ERROR_CODES.VALIDATION_ERROR, decision.message);
    const saved = await persistLabelPdf(supabase, {
      organizationId: ctx.organizationId,
      shipmentId: rendered.shipmentId,
      kind: "CUSTOM_SHIPPING",
      bytes: rendered.pdf,
      templateSnapshot: {
        ...sheetSnapshot(rendered.template, {
          ...rendered.template.page,
          paperSize: decision.paperSize as LabelTemplate["page"]["paperSize"],
          widthMm: rendered.request.sheet.widthMm,
          heightMm: rendered.request.sheet.heightMm,
          widthPt: rendered.layout.sheetWidthPt,
          heightPt: rendered.layout.sheetHeightPt,
        }),
        sheetMembers: rendered.members,
        sheetItems: rendered.request.items,
      },
    });
    await insertLabelSheetMembers(supabase, {
      organizationId: ctx.organizationId,
      labelId: saved.id,
      members: rendered.members,
    });
    const job = await enqueueManualPrintJob(supabase, ctx, saved.id, { paperSize: decision.paperSize, copies: 1 });
    const result: MultiSheetPrintResult = {
      labelId: saved.id,
      job: { id: job.id, status: job.status, source: job.source, paperSize: decision.paperSize },
      connected: station.connected,
      message: station.connected
        ? "Queued for the Print Agent. Windows will receive the sheet when this computer claims it."
        : "Queued. The sheet will send to Windows when the selected Print Agent reconnects.",
    };
    await supabase.from("audit_logs").insert({
      organization_id: ctx.organizationId,
      actor_id: ctx.userId,
      action: "labels.multi_sheet.print",
      entity_type: "label",
      entity_id: saved.id,
      after: {
        jobId: job.id,
        paperSize: decision.paperSize,
        shipmentIds: rendered.members.map((member) => member.shipmentId),
        orderIds: rendered.members.map((member) => member.orderId),
      },
    });
    if (claimed?.key) {
      await storeMultiSheetPrintKey(supabase, ctx.organizationId, claimed.key, result);
    }
    return result;
  } catch (error) {
    if (claimed?.key) {
      await releaseMultiSheetPrintKey(supabase, ctx.organizationId, claimed.key);
    }
    throw error;
  }
}
