import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { invoicePreviewData, invoicePreviewPayload, resolveStoreWebsite } from "@/modules/invoices/data";
import { invoicePdfFilename, renderInvoicePdf } from "@/modules/invoices/pdf";
import { parseInvoiceAppearance } from "@/modules/invoices/schema";
import {
  getInvoice,
  listInvoices,
  loadInvoicePdfBytes,
  regenerateInvoice,
  retryInvoice,
} from "@/modules/invoices/service";
import { getInvoiceSettings, resetInvoiceAppearance, saveInvoiceSettings } from "@/modules/invoices/settings";

export async function handleInvoiceRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  key: string,
  method: string,
  slugs: string[]
) {
  if (key === "GET invoices") {
    return listInvoices(supabase, ctx.organizationId, {
      page: Number(request.nextUrl.searchParams.get("page") || 1),
      pageSize: Number(request.nextUrl.searchParams.get("pageSize") || 20),
    });
  }

  if (method === "GET" && slugs[0] === "invoices" && slugs[1] && slugs[2] === "download") {
    const file = await loadInvoicePdfBytes(supabase, ctx.organizationId, slugs[1]);
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${file.filename}"`,
      },
    });
  }

  if (method === "POST" && slugs[0] === "invoices" && slugs[2] === "retry") {
    return retryInvoice(supabase, ctx.organizationId, slugs[1], ctx.userId);
  }

  if (method === "POST" && slugs[0] === "invoices" && slugs[2] === "regenerate") {
    const body = (await request.json().catch(() => ({}))) as { confirm?: boolean };
    if (!body.confirm) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Confirm regenerate to replace the invoice PDF.");
    }
    return regenerateInvoice(supabase, ctx.organizationId, slugs[1]);
  }

  if (method === "GET" && slugs[0] === "invoices" && slugs[1] && !slugs[2]) {
    return getInvoice(supabase, ctx.organizationId, slugs[1]);
  }

  if (key === "GET invoice-template") {
    const settings = await getInvoiceSettings(supabase, ctx.organizationId);
    const resolvedWebsite = await resolveStoreWebsite(supabase, ctx.organizationId, settings.website);
    return { ...settings, resolvedWebsite };
  }

  if (key === "PUT invoice-template") {
    const body = (await request.json().catch(() => ({}))) as {
      appearance?: unknown;
      gstin?: string | null;
      businessEmail?: string | null;
      business_email?: string | null;
      website?: string | null;
      reset?: boolean;
    };
    if (body.reset) {
      return resetInvoiceAppearance(supabase, ctx.organizationId);
    }
    const appearance = parseInvoiceAppearance(body.appearance);
    const gstin = typeof body.gstin === "string" ? body.gstin : undefined;
    if (gstin && gstin.trim() && !/^[0-9A-Z]{15}$/i.test(gstin.trim())) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "GSTIN must be 15 characters.");
    }
    return saveInvoiceSettings(supabase, ctx.organizationId, {
      appearance,
      gstin: gstin ?? null,
      businessEmail: body.businessEmail ?? body.business_email ?? null,
      ...(typeof body.website === "string" ? { website: body.website } : {}),
    });
  }

  if (key === "GET invoice-template/preview-data") {
    const packed = await invoicePreviewData(supabase, ctx.organizationId);
    return {
      sample: packed.sample,
      shipmentId: packed.shipmentId,
      data: invoicePreviewPayload(packed.data),
      appearance: packed.data.appearance,
    };
  }

  if (key === "POST invoice-template/preview") {
    const body = (await request.json().catch(() => ({}))) as { appearance?: unknown };
    const appearance = parseInvoiceAppearance(body.appearance);
    const packed = await invoicePreviewData(supabase, ctx.organizationId, appearance);
    packed.data.appearance = appearance;
    const bytes = await renderInvoicePdf(packed.data);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${invoicePdfFilename(packed.data.invoiceNumber)}"`,
      },
    });
  }

  return null;
}
