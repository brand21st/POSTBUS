import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { fetchOfficialIndiaPostLabelPdf } from "@/modules/labels/official-fetch";
import { persistPackingSlip } from "@/modules/labels/packing-fetch";
import { persistLabelPdf } from "@/modules/labels/persist";
import { loadLabelPdfBytes } from "@/modules/labels/load";
import { pickOfficialPreviewLabel } from "@/modules/labels/preview-pick";
import { parseLabelTemplate } from "@/modules/labels/template-schema";
import { getLabelTemplate, saveLabelTemplate } from "@/modules/labels/template-service";
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
