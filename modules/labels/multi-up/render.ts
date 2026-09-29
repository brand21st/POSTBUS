import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { loadCustomShippingLabel } from "@/modules/labels/custom-label-service";
import { renderMerchantLabelPdf } from "@/modules/labels/packing-pdf";
import { persistLabelPdf } from "@/modules/labels/persist";
import { enqueueManualPrintJob, getPrintStation } from "@/modules/print/service";
import { multiUpPrintEnabled } from "@/modules/labels/multi-up/flag";
import { applyPlacementOverrides, calculateMultiUpLayout } from "@/modules/labels/multi-up/layout";
import { composeMultiUpPdf } from "@/modules/labels/multi-up/pdf";
import { multiUpPrintDecision } from "@/modules/labels/multi-up/print";
import { labelSizeMm, parseMultiUpRequest } from "@/modules/labels/multi-up/request";
import { getLabelTemplate } from "@/modules/labels/template-service";
import { selectLabelTemplate, type LabelTemplate } from "@/modules/labels/template-schema";

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

  const pdfs = new Map<string, Uint8Array>();
  let shipmentId = "";
  for (const item of request.items) {
    if (pdfs.has(item.orderId)) continue;
    const loaded = await loadCustomShippingLabel(supabase, organizationId, {
      orderId: item.orderId,
      templateId: request.templateId,
    });
    if (!shipmentId) shipmentId = loaded.shipmentId;
    pdfs.set(item.orderId, await renderMerchantLabelPdf(loaded.template, loaded.data));
  }
  const pdf = await composeMultiUpPdf(
    layout,
    layout.placements.map((placement) => {
      const bytes = pdfs.get(placement.orderId);
      if (!bytes) throw new AppError(ERROR_CODES.LABEL_GENERATION_FAILED, "A label PDF is missing.");
      return bytes;
    })
  );
  return { request, template, layout, pdf, shipmentId };
}

export async function printMultiUpSheet(supabase: SupabaseClient, ctx: TenantContext, body: unknown) {
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
    templateSnapshot: sheetSnapshot(rendered.template, {
      ...rendered.template.page,
      paperSize: decision.paperSize as LabelTemplate["page"]["paperSize"],
      widthMm: rendered.request.sheet.widthMm,
      heightMm: rendered.request.sheet.heightMm,
      widthPt: rendered.layout.sheetWidthPt,
      heightPt: rendered.layout.sheetHeightPt,
    }),
  });
  const job = await enqueueManualPrintJob(supabase, ctx, saved.id, { paperSize: decision.paperSize, copies: 1 });
  return {
    labelId: saved.id,
    job: { id: job.id, status: job.status, source: job.source, paperSize: decision.paperSize },
    connected: true,
    message: "Sheet sent to the printer.",
  };
}
