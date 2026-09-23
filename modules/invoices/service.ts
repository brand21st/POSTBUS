import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { createBackgroundJob } from "@/modules/jobs/service";
import { invoiceDataForShipment } from "@/modules/invoices/data";
import { renderInvoicePdf } from "@/modules/invoices/pdf";
import { parseInvoiceAppearance, shouldSkipInvoiceGeneration, istDateIso } from "@/modules/invoices/schema";
import { getInvoiceSettings } from "@/modules/invoices/settings";
import { readInvoicePdfIfPresent, saveInvoicePdf } from "@/modules/invoices/storage";

export type ShippingInvoiceRow = {
  id: string;
  organization_id: string;
  order_id: string;
  shipment_id: string;
  invoice_number: string;
  tracking_number: string | null;
  file_path: string | null;
  status: string;
  error_message: string | null;
  invoice_date: string;
  currency: string;
  subtotal: number | string;
  discount: number | string;
  shipping_amount: number | string;
  tax_amount: number | string;
  total_amount: number | string;
  created_at: string;
  updated_at: string;
};

export function mapInvoice(row: Record<string, unknown>) {
  const order = row.orders as { order_number?: string } | null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    orderId: row.order_id,
    order_id: row.order_id,
    shipmentId: row.shipment_id,
    shipment_id: row.shipment_id,
    invoiceNumber: row.invoice_number,
    invoice_number: row.invoice_number,
    trackingNumber: row.tracking_number,
    tracking_number: row.tracking_number,
    filePath: row.file_path,
    status: row.status,
    errorMessage: row.error_message,
    error_message: row.error_message,
    invoiceDate: row.invoice_date,
    invoice_date: row.invoice_date,
    currency: row.currency,
    totalAmount: row.total_amount,
    total_amount: row.total_amount,
    orderNumber: order?.order_number ?? row.order_number,
    order_number: order?.order_number ?? row.order_number,
    createdAt: row.created_at,
    created_at: row.created_at,
  };
}

export function invoiceSummary(row: Record<string, unknown> | null | undefined) {
  if (!row?.id) return null;
  return {
    id: String(row.id),
    status: String(row.status || "PENDING"),
    invoiceNumber: String(row.invoice_number || ""),
    invoice_number: String(row.invoice_number || ""),
    errorMessage: (row.error_message as string | null) ?? null,
  };
}

async function allocateInvoiceNumber(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase.rpc("allocate_shipping_invoice_number", {
    p_organization_id: organizationId,
  });
  if (error || !data) {
    throw new Error(error?.message || "Could not allocate an invoice number.");
  }
  return String(data);
}

async function loadInvoiceByShipment(supabase: SupabaseClient, organizationId: string, shipmentId: string) {
  const { data, error } = await supabase
    .from("shipping_invoices")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("shipment_id", shipmentId)
    .maybeSingle();
  if (error) throw error;
  return data as ShippingInvoiceRow | null;
}

export async function getInvoice(supabase: SupabaseClient, organizationId: string, id: string) {
  const { data, error } = await supabase
    .from("shipping_invoices")
    .select("*, orders(order_number)")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Invoice not found.");
  return mapInvoice(data as Record<string, unknown>);
}

export async function listInvoices(
  supabase: SupabaseClient,
  organizationId: string,
  query: { page: number; pageSize: number }
) {
  const from = (query.page - 1) * query.pageSize;
  const { data, error, count } = await supabase
    .from("shipping_invoices")
    .select("*, orders(order_number)", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(from, from + query.pageSize - 1);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return {
    items: (data ?? []).map((row) => mapInvoice(row as Record<string, unknown>)),
    page: query.page,
    pageSize: query.pageSize,
    total: count ?? 0,
  };
}

async function ensureInvoiceRow(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    shipmentId: string;
    orderId: string;
    trackingNumber: string;
    currency: string;
    totals: { subtotal: number; discount: number; shippingAmount: number; taxAmount: number; total: number };
  }
) {
  const existing = await loadInvoiceByShipment(supabase, input.organizationId, input.shipmentId);
  if (existing) return existing;

  const invoiceNumber = await allocateInvoiceNumber(supabase, input.organizationId);
  const insert = {
    organization_id: input.organizationId,
    order_id: input.orderId,
    shipment_id: input.shipmentId,
    invoice_number: invoiceNumber,
    tracking_number: input.trackingNumber,
    status: "PENDING",
    invoice_date: istDateIso(),
    currency: input.currency,
    subtotal: input.totals.subtotal,
    discount: input.totals.discount,
    shipping_amount: input.totals.shippingAmount,
    tax_amount: input.totals.taxAmount,
    total_amount: input.totals.total,
  };
  const { data, error } = await supabase.from("shipping_invoices").insert(insert).select("*").maybeSingle();
  if (!error && data) return data as ShippingInvoiceRow;

  const duplicate = await loadInvoiceByShipment(supabase, input.organizationId, input.shipmentId);
  if (duplicate) return duplicate;
  throw new Error(error?.message || "Could not create the invoice record.");
}

export async function generateShippingInvoice(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentId: string,
  opts?: { force?: boolean }
) {
  const { data: shipment, error } = await supabase
    .from("shipments")
    .select("id, order_id, barcode, tracking_number")
    .eq("organization_id", organizationId)
    .eq("id", shipmentId)
    .maybeSingle();
  if (error) throw error;
  if (!shipment?.order_id) {
    throw Object.assign(new Error("Shipment is missing."), { code: "VALIDATION_ERROR" });
  }
  const tracking = String(shipment.tracking_number || shipment.barcode || "").trim();
  if (!tracking) {
    throw Object.assign(new Error("Invoice generation needs a tracking number."), { code: "VALIDATION_ERROR" });
  }

  const existing = await loadInvoiceByShipment(supabase, organizationId, shipmentId);
  if (!opts?.force && shouldSkipInvoiceGeneration(existing?.status, existing?.file_path)) {
    const bytes = await readInvoicePdfIfPresent({
      relativePath: String(existing?.file_path),
      organizationId,
      invoiceId: existing?.id,
    });
    if (bytes) return existing;
  }

  const settings = await getInvoiceSettings(supabase, organizationId);
  let row = existing;
  try {
    const draftNumber = existing?.invoice_number;
    const data = await invoiceDataForShipment(supabase, organizationId, shipmentId, {
      invoiceNumber: draftNumber || "PENDING",
      appearance: settings.appearance,
    });
    row = await ensureInvoiceRow(supabase, {
      organizationId,
      shipmentId,
      orderId: String(shipment.order_id),
      trackingNumber: tracking,
      currency: data.currency,
      totals: {
        subtotal: data.subtotal,
        discount: data.discount,
        shippingAmount: data.shippingAmount,
        taxAmount: data.taxAmount,
        total: data.total,
      },
    });
    if (!opts?.force && shouldSkipInvoiceGeneration(row.status, row.file_path)) {
      const bytes = await readInvoicePdfIfPresent({
        relativePath: String(row.file_path),
        organizationId,
        invoiceId: row.id,
      });
      if (bytes) return row;
    }

    data.invoiceNumber = row.invoice_number;
    data.invoiceDate = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(`${row.invoice_date}T00:00:00+05:30`));
    data.appearance = settings.appearance;
    const bytes = await renderInvoicePdf(data);
    const filePath = await saveInvoicePdf({
      organizationId,
      invoiceId: row.id,
      bytes: Buffer.from(bytes),
    });
    const { data: updated, error: updateError } = await supabase
      .from("shipping_invoices")
      .update({
        status: "GENERATED",
        file_path: filePath,
        tracking_number: tracking,
        error_message: null,
        appearance_snapshot: parseInvoiceAppearance(settings.appearance),
        subtotal: data.subtotal,
        discount: data.discount,
        shipping_amount: data.shippingAmount,
        tax_amount: data.taxAmount,
        total_amount: data.total,
        currency: data.currency,
      })
      .eq("id", row.id)
      .eq("organization_id", organizationId)
      .select("*")
      .maybeSingle();
    if (updateError) throw updateError;
    return updated ?? row;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Invoice generation failed.";
    if (row?.id) {
      await supabase
        .from("shipping_invoices")
        .update({ status: "FAILED", error_message: message })
        .eq("id", row.id)
        .eq("organization_id", organizationId);
    }
    logError("INVOICE_GENERATION_FAILED", { organizationId, shipmentId, invoiceId: row?.id, message });
    throw Object.assign(caught instanceof Error ? caught : new Error(message), {
      code: (caught as { code?: string })?.code || "JOB_FAILED",
    });
  }
}

export async function enqueueInvoiceGeneration(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentId: string,
  userId?: string
) {
  return createBackgroundJob(supabase, {
    organizationId,
    jobType: "invoice-generation",
    entityType: "shipment",
    entityId: shipmentId,
    userId,
  });
}

export async function retryInvoice(supabase: SupabaseClient, organizationId: string, id: string, userId?: string) {
  const invoice = await getInvoice(supabase, organizationId, id);
  if (String(invoice.status).toUpperCase() === "GENERATED") {
    throw new AppError(ERROR_CODES.CONFLICT, "This invoice is already generated.");
  }
  await supabase
    .from("shipping_invoices")
    .update({ status: "PENDING", error_message: null })
    .eq("id", id)
    .eq("organization_id", organizationId);
  const job = await enqueueInvoiceGeneration(supabase, organizationId, String(invoice.shipmentId), userId);
  return { id, jobId: job.id, message: "Invoice retry queued." };
}

export async function regenerateInvoice(
  supabase: SupabaseClient,
  organizationId: string,
  id: string
) {
  const invoice = await getInvoice(supabase, organizationId, id);
  const row = await generateShippingInvoice(supabase, organizationId, String(invoice.shipmentId), { force: true });
  return { ...mapInvoice(row as unknown as Record<string, unknown>), message: "Invoice regenerated." };
}

export async function loadInvoicePdfBytes(
  supabase: SupabaseClient,
  organizationId: string,
  id: string
) {
  const { data } = await supabase
    .from("shipping_invoices")
    .select("id, file_path, invoice_number, status")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (!data?.file_path) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Invoice file not found.");
  }
  const bytes = await readInvoicePdfIfPresent({
    relativePath: String(data.file_path),
    organizationId,
    invoiceId: String(data.id),
  });
  if (!bytes) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Invoice file not found.");
  }
  return { bytes, filename: `${data.invoice_number || data.id}.pdf` };
}
