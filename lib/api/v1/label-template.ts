import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import {
  customLabelBarcodePng,
  loadCustomShippingLabel,
  previewFromPacking,
  printCustomShippingLabel,
  renderCustomShippingLabel,
  renderSampleCustomShippingLabel,
  type CustomLabelRequest,
} from "@/modules/labels/custom-label-service";
import { fetchOfficialIndiaPostLabelPdf } from "@/modules/labels/official-fetch";
import { persistPackingSlip } from "@/modules/labels/packing-fetch";
import { persistLabelPdf } from "@/modules/labels/persist";
import { loadLabelPdfBytes } from "@/modules/labels/load";
import { pickOfficialPreviewLabel } from "@/modules/labels/preview-pick";
import { parseLabelTemplate } from "@/modules/labels/template-schema";
import { getLabelTemplate, saveLabelTemplate } from "@/modules/labels/template-service";
import { organizationLogoUrl } from "@/modules/organizations/branding";
import { printMultiUpSheet, renderMultiUpSheet } from "@/modules/labels/multi-up/render";
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
    const { data: org } = await supabase
      .from("organizations")
      .select("logo_path")
      .eq("id", ctx.organizationId)
      .maybeSingle();
    return { template, logoUrl: organizationLogoUrl(org?.logo_path) };
  }

  if (key === "PUT label-template") {
    const body = (await request.json().catch(() => ({}))) as { template?: unknown };
    const template = parseLabelTemplate(body.template);
    const saved = await saveLabelTemplate(supabase, ctx.organizationId, template);
    await updatePrintSettings(supabase, ctx, { paperSize: saved.page.paperSize }).catch(() => null);
    return { template: saved };
  }

  if (key === "GET label-template/preview-data") {
    const official = await loadOfficialLabel(supabase, ctx.organizationId, null);
    return { sample: !official, shipmentId: official?.shipmentId ?? null };
  }

  if (key === "POST label-template/preview") {
    const official = await loadOfficialLabel(supabase, ctx.organizationId, null);
    if (!official) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Book a shipment to preview the India Post label.");
    }
    return new NextResponse(Buffer.from(official.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="india-post-label.pdf"',
      },
    });
  }

  if (key === "GET label-template/barcode") {
    const barcode = await customLabelBarcodePng(supabase, ctx.organizationId, customLabelQuery(request));
    if (!barcode.png) {
      return { articleId: "", shipmentId: barcode.shipmentId };
    }
    return new NextResponse(new Uint8Array(barcode.png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (key === "GET label-template/custom-data") {
    const loaded = await loadCustomShippingLabel(supabase, ctx.organizationId, customLabelQuery(request));
    return { preview: previewFromPacking(loaded.data, loaded.shipmentId) };
  }

  if (key === "POST label-template/custom-preview" || key === "POST label-template/custom-download") {
    const body = await readCustomLabelBody(request);
    const hasTarget = Boolean(body.shipmentId?.trim() || body.orderId?.trim());
    if (!hasTarget && key.endsWith("custom-download")) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Load an order to download the shipping label.");
    }
    const rendered = hasTarget
      ? await renderCustomShippingLabel(supabase, ctx.organizationId, body)
      : await renderSampleCustomShippingLabel(supabase, ctx.organizationId, body);
    const filename = `shipping-label-${rendered.shipmentId || "preview"}.pdf`;
    const disposition = key.endsWith("custom-download") ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(rendered.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${filename}"`,
      },
    });
  }

  if (key === "POST label-template/multi-sheet") {
    const body = await request.json().catch(() => ({}));
    const disposition = body && typeof body === "object" ? (body as { disposition?: string }).disposition : "inline";
    if (disposition === "print") return printMultiUpSheet(supabase, ctx, body);
    const rendered = await renderMultiUpSheet(supabase, ctx.organizationId, body);
    const filename = "shipping-labels.pdf";
    const download = disposition === "attachment" ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(rendered.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download}; filename="${filename}"`,
      },
    });
  }

  if (key === "POST label-template/custom-print") {
    const body = await readCustomLabelBody(request);
    const printed = await printCustomShippingLabel(supabase, ctx, body);
    return {
      labelId: printed.labelId,
      job: printed.job,
      connected: printed.connected,
      downloadPath: printed.downloadPath,
      message: printed.message,
    };
  }

  if (key === "POST label-template/print-test") {
    const body = (await request.json().catch(() => ({}))) as { copies?: number };
    const official = await loadOfficialLabel(supabase, ctx.organizationId, null);
    if (!official) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Book a shipment to print the India Post label.");
    }
    const job = await enqueueManualPrintJob(supabase, ctx, official.id, {
      paperSize: "A6",
      copies: body.copies,
    });
    const station = await getPrintStation(supabase, ctx.organizationId);
    return {
      job: { id: job.id, status: job.status, source: job.source, paperSize: "A6" },
      labelId: official.id,
      connected: station.connected,
      message: station.connected
        ? "India Post label sent to the printer."
        : "Printer unavailable. Opening the official India Post PDF.",
      downloadPath: `/api/v1/labels/${official.id}/download?raw=1`,
    };
  }

  if (method === "POST" && slugs[0] === "labels" && slugs[2] === "packing-slip") {
    const { data: existing } = await supabase
      .from("labels")
      .select("id, shipment_id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", slugs[1])
      .maybeSingle();
    if (!existing?.shipment_id) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Label not found.");
    const packing = await persistPackingSlip(supabase, ctx.organizationId, String(existing.shipment_id));
    return {
      id: packing.id,
      kind: "MERCHANT",
      shipmentId: existing.shipment_id,
      downloadPath: `/api/v1/labels/${packing.id}/download`,
    };
  }

  if (method === "POST" && slugs[0] === "labels" && slugs[2] === "regenerate") {
    const body = (await request.json().catch(() => ({}))) as { confirm?: boolean };
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

    const official = await fetchOfficialIndiaPostLabelPdf(supabase, ctx.organizationId, String(existing.shipment_id));
    const created = await persistLabelPdf(supabase, {
      organizationId: ctx.organizationId,
      shipmentId: official.shipmentId,
      kind: "INDIA_POST",
      bytes: official.pdf,
    });
    try {
      await persistPackingSlip(supabase, ctx.organizationId, official.shipmentId, { replace: true });
    } catch (error) {
      logError("PACKING_LABEL_FAILED", {
        organizationId: ctx.organizationId,
        shipmentId: official.shipmentId,
        message: error instanceof Error ? error.message : "unknown",
      });
      return {
        id: created.id,
        kind: "INDIA_POST",
        message:
          error instanceof Error
            ? `A new India Post label was generated. Packing slip skipped: ${error.message}`
            : "A new India Post label was generated. Packing slip skipped.",
      };
    }
    return { id: created.id, kind: "INDIA_POST", message: "A new India Post label and packing slip were generated." };
  }

  return null;
}

function customLabelQuery(request: NextRequest): CustomLabelRequest {
  return {
    shipmentId: request.nextUrl.searchParams.get("shipmentId"),
    orderId: request.nextUrl.searchParams.get("orderId"),
    templateId: request.nextUrl.searchParams.get("templateId"),
    paymentPreview: paymentPreview(request.nextUrl.searchParams.get("paymentPreview")),
  };
}

async function readCustomLabelBody(request: NextRequest): Promise<CustomLabelRequest> {
  const body = (await request.json().catch(() => ({}))) as {
    shipmentId?: string;
    orderId?: string;
    templateId?: string;
    paymentPreview?: string;
    template?: unknown;
  };
  return {
    shipmentId: body.shipmentId,
    orderId: body.orderId,
    templateId: body.templateId,
    paymentPreview: paymentPreview(body.paymentPreview),
    template: body.template,
  };
}

function paymentPreview(value?: string | null): "COD" | "PREPAID" | null {
  const mode = (value ?? "").toUpperCase();
  if (mode === "COD" || mode === "PREPAID") return mode;
  return null;
}

async function loadOfficialLabel(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentId: string | null
) {
  const { data } = await supabase
    .from("labels")
    .select("id, file_path, file_url, shipment_id, kind, status")
    .eq("organization_id", organizationId)
    .eq("status", "READY")
    .order("created_at", { ascending: false })
    .limit(80);
  const picked = pickOfficialPreviewLabel(data ?? [], shipmentId);
  if (!picked?.id || (!picked.file_path && !picked.file_url)) return null;
  try {
    const bytes = await loadLabelPdfBytes(supabase, organizationId, {
      id: picked.id,
      file_path: picked.file_path || "",
      file_url: picked.file_url,
      shipment_id: picked.shipment_id,
    });
    return { id: picked.id, shipmentId: picked.shipment_id ?? null, bytes };
  } catch {
    return null;
  }
}
