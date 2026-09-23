import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { fetchOfficialIndiaPostLabelPdf } from "@/modules/labels/official-fetch";
import { packingDataForOrganization } from "@/modules/labels/packing-data";
import { renderMerchantLabelPdf } from "@/modules/labels/packing-pdf";
import { persistLabelPdf } from "@/modules/labels/persist";
import { applyPaperSize, parseLabelTemplate } from "@/modules/labels/template-schema";
import {
  getLabelTemplate,
  persistMerchantPackingLabel,
  saveLabelTemplate,
} from "@/modules/labels/template-service";
import { isPaperSizeId } from "@/modules/labels/page-presets";
import { enqueueManualPrintJob, getPrintStation, updatePrintSettings } from "@/modules/print/service";

export async function handleLabelTemplateRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  key: string,
  method: string,
  slugs: string[]
) {
  if (key === "GET label-template") {
    const template = await getLabelTemplate(supabase, ctx.organizationId);
    return { template };
  }

  if (key === "PUT label-template") {
    const body = (await request.json().catch(() => ({}))) as { template?: unknown };
    const template = parseLabelTemplate(body.template);
    const saved = await saveLabelTemplate(supabase, ctx.organizationId, template);
    await updatePrintSettings(supabase, ctx, { paperSize: saved.page.paperSize }).catch(() => null);
    return { template: saved };
  }

  if (key === "GET label-template/preview-data") {
    const packed = await packingDataForOrganization(supabase, ctx.organizationId);
    const { data } = packed;
    return {
      sample: packed.sample,
      shipmentId: packed.shipmentId,
      data: {
        storeName: data.storeName,
        storePhone: data.storePhone,
        storeWebsite: data.storeWebsite,
        orderNumber: data.orderNumber,
        shopifyOrderNumber: data.shopifyOrderNumber,
        items: data.items,
        subtotal: data.subtotal,
        shipping: data.shipping,
        discount: data.discount,
        total: data.total,
        codAmount: data.codAmount,
        paymentMethod: data.paymentMethod,
        customerNote: data.customerNote,
        returnAddress: data.returnAddress,
        hasLogo: Boolean(data.logoBytes),
      },
    };
  }

  if (key === "POST label-template/preview") {
    const body = (await request.json().catch(() => ({}))) as { template?: unknown; paperSize?: string };
    let template = parseLabelTemplate(body.template ?? (await getLabelTemplate(supabase, ctx.organizationId)));
    if (body.paperSize && isPaperSizeId(body.paperSize)) {
      template = applyPaperSize(template, body.paperSize);
    }
    const packed = await packingDataForOrganization(supabase, ctx.organizationId);
    const bytes = await renderMerchantLabelPdf(template, packed.data);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="packing-label-preview.pdf"',
      },
    });
  }

  if (key === "POST label-template/print-test") {
    const body = (await request.json().catch(() => ({}))) as {
      template?: unknown;
      paperSize?: string;
      copies?: number;
    };
    const paperSize = body.paperSize && isPaperSizeId(body.paperSize) ? body.paperSize : "A6";
    let template = parseLabelTemplate(body.template ?? (await getLabelTemplate(supabase, ctx.organizationId)));
    template = applyPaperSize(template, paperSize);
    const packed = await packingDataForOrganization(supabase, ctx.organizationId);
    const bytes = await renderMerchantLabelPdf(template, packed.data);

    if (!packed.shipmentId) {
      return new NextResponse(Buffer.from(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'inline; filename="packing-label-test.pdf"',
          "X-Print-Fallback": "preview",
        },
      });
    }

    const label = await persistLabelPdf(supabase, {
      organizationId: ctx.organizationId,
      shipmentId: packed.shipmentId,
      kind: "MERCHANT",
      bytes: Buffer.from(bytes),
      templateSnapshot: template,
    });
    const job = await enqueueManualPrintJob(supabase, ctx, label.id, {
      paperSize,
      copies: body.copies,
    });
    const station = await getPrintStation(supabase, ctx.organizationId);
    return {
      job: { id: job.id, status: job.status, source: job.source, paperSize },
      labelId: label.id,
      connected: station.connected,
      message: station.connected
        ? `Test packing label sent to the printer (${paperSize}).`
        : "Printer unavailable. Opening the test PDF so you can check the size.",
      downloadPath: `/api/v1/labels/${label.id}/download`,
    };
  }

  if (method === "POST" && slugs[0] === "labels" && slugs[2] === "regenerate") {
    const body = (await request.json().catch(() => ({}))) as { confirm?: boolean; kind?: string };
    if (!body.confirm) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Confirm regenerate to create a new label file.");
    }
    const { data: existing } = await supabase
      .from("labels")
      .select("id, shipment_id, kind")
      .eq("organization_id", ctx.organizationId)
      .eq("id", slugs[1])
      .maybeSingle();
    if (!existing) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Label not found.");

    const kind = (body.kind || existing.kind || "INDIA_POST").toUpperCase();
    if (kind === "MERCHANT") {
      const created = await persistMerchantPackingLabel(supabase, {
        organizationId: ctx.organizationId,
        shipmentId: String(existing.shipment_id),
      });
      return { id: created.id, kind: "MERCHANT", message: "A new packing label was generated." };
    }

    const official = await fetchOfficialIndiaPostLabelPdf(supabase, ctx.organizationId, String(existing.shipment_id));
    const created = await persistLabelPdf(supabase, {
      organizationId: ctx.organizationId,
      shipmentId: official.shipmentId,
      kind: "INDIA_POST",
      bytes: official.pdf,
    });
    return { id: created.id, kind: "INDIA_POST", message: "A new India Post label was generated." };
  }

  return null;
}
