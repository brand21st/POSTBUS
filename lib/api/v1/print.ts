import { NextRequest, NextResponse } from "next/server";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import {
  authenticatePrintAgent,
  claimNextPrintJob,
  completePrintJob,
  getPrintStation,
  heartbeatPrintAgent,
  isPrintAgentApiPath,
  loadPrintJobPdf,
  rotatePrintAgentToken,
  updatePrintSettings,
} from "@/modules/print/service";

export { isPrintAgentApiPath };

export async function handlePrintAgentRoutes(request: NextRequest, path: string, slugs: string[]) {
  if (!isPrintAgentApiPath(path)) return null;
  if (!hasAdminClient()) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Print agent API is not configured.");
  }
  const supabase = createAdminClient();
  const agent = await authenticatePrintAgent(supabase, request.headers.get("authorization"));
  const method = request.method;

  if (path === "print-agent/heartbeat" && method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { printers?: unknown };
    const printers = Array.isArray(body.printers) ? body.printers.map((item) => String(item)) : [];
    return heartbeatPrintAgent(supabase, agent, printers);
  }

  if (path === "print-agent/jobs/claim" && method === "POST") {
    return claimNextPrintJob(supabase, agent);
  }

  if (slugs[0] === "print-jobs" && slugs[1] && slugs[2] === "pdf" && method === "GET") {
    const { bytes, filename } = await loadPrintJobPdf(supabase, agent, slugs[1]);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  }

  if (slugs[0] === "print-jobs" && slugs[1] && !slugs[2] && method === "PATCH") {
    const body = (await request.json().catch(() => ({}))) as {
      status?: string;
      error?: string;
      errorMessage?: string;
    };
    if (body.status !== "PRINTED" && body.status !== "FAILED" && body.status !== "PENDING") {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Print status must be PRINTED, FAILED, or PENDING.");
    }
    return completePrintJob(supabase, agent, slugs[1], {
      status: body.status,
      errorMessage: body.errorMessage ?? body.error,
    });
  }

  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}

export async function handlePrintStationRoutes(
  request: NextRequest,
  supabase: Parameters<typeof getPrintStation>[0],
  ctx: TenantContext,
  key: string,
  method: string,
  slugs: string[]
) {
  if (key === "GET print-station") {
    return getPrintStation(supabase, ctx.organizationId);
  }

  if (key === "PATCH print-station") {
    const body = (await request.json().catch(() => ({}))) as {
      selectedPrinterName?: string | null;
      selected_printer_name?: string | null;
      paperSize?: string;
      paper_size?: string;
      orientation?: string;
    copies?: number;
    autoPrintMerchant?: boolean;
    auto_print_merchant?: boolean;
  };
  return updatePrintSettings(supabase, ctx, {
    selectedPrinterName: body.selectedPrinterName ?? body.selected_printer_name,
    paperSize: body.paperSize ?? body.paper_size,
    orientation: body.orientation,
    copies: body.copies,
    autoPrintMerchant: body.autoPrintMerchant ?? body.auto_print_merchant,
  });
  }

  if (key === "POST print-station/token") {
    return rotatePrintAgentToken(supabase, ctx);
  }

  if (method === "POST" && slugs[0] === "labels" && slugs[2] === "print") {
    const { enqueueManualPrintJob } = await import("@/modules/print/service");
    const body = (await request.json().catch(() => ({}))) as { paperSize?: string };
    const job = await enqueueManualPrintJob(supabase, ctx, slugs[1], { paperSize: body.paperSize });
    const station = await getPrintStation(supabase, ctx.organizationId);
    return {
      job: {
        id: job.id,
        status: job.status,
        source: job.source,
      },
      connected: station.connected,
      message: station.connected
        ? "Sent to the printer."
        : "Printer unavailable. The job will print when the printer reconnects.",
    };
  }

  return null;
}
