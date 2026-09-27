import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { CustomLabelPreview } from "@/modules/labels/custom-blocks";
import { addressLineTexts, addressPartsFromParty } from "@/modules/labels/address-layout";
import { indiaPostBarcodePng } from "@/modules/labels/india-post-barcode-image";
import { loadPackingLabelData } from "@/modules/labels/packing-fetch";
import { renderMerchantLabelPdf, type PackingLabelData } from "@/modules/labels/packing-pdf";
import { loadLogoBytes, SAMPLE_PACKING_DATA } from "@/modules/labels/packing-data";
import { persistLabelPdf } from "@/modules/labels/persist";
import { enqueueManualPrintJob, getPrintStation } from "@/modules/print/service";
import { getLabelTemplate } from "@/modules/labels/template-service";
import { printMediaForPage } from "@/modules/labels/page-presets";
import { parseLabelTemplate, selectLabelTemplate, type LabelTemplate } from "@/modules/labels/template-schema";
import { organizationLogoUrl } from "@/modules/organizations/branding";

export type CustomLabelRequest = {
  shipmentId?: string | null;
  orderId?: string | null;
  templateId?: string | null;
  paymentPreview?: "COD" | "PREPAID" | null;
  template?: unknown;
};

export function previewFromPacking(data: PackingLabelData, shipmentId: string): CustomLabelPreview {
  return {
    shipmentId,
    articleId: data.articleId || "",
    articleType: data.articleType && data.articleType !== "—" ? data.articleType : "",
    contractId: data.contractId?.trim() || "",
    customerId: data.customerId?.trim() || "",
    paymentMode: data.paymentMode || data.paymentMethod || "",
    orderNumber: data.orderNumber,
    orderDate: data.orderDate,
    fromLines: [data.sender.name, ...data.sender.lines, data.sender.phone ? `Ph: ${data.sender.phone}` : ""].filter(Boolean),
    shipParts: addressPartsFromParty(data.receiver),
    fromParts: addressPartsFromParty(data.sender),
    shipLines: addressLineTexts(undefined, addressPartsFromParty(data.receiver)),
    items: data.items.map((item) => ({
      title: item.title,
      sku: item.sku,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      weightGrams: item.weightGrams,
      note: item.note,
    })),
    total: data.total,
    codAmount: data.codAmount,
    weightGrams: data.weightGrams,
    lengthCm: data.lengthCm,
    widthCm: data.widthCm,
    heightCm: data.heightCm,
    logoUrl: data.logoUrl ?? null,
  };
}

export function orderNumberCandidates(value: string) {
  const key = value.trim();
  const withoutHash = key.replace(/^#+/, "");
  return [...new Set([key, withoutHash, withoutHash ? `#${withoutHash}` : ""].filter(Boolean))];
}

export async function resolveCustomLabelShipment(
  supabase: SupabaseClient,
  organizationId: string,
  input: CustomLabelRequest
) {
  const shipmentId = (input.shipmentId ?? "").trim();
  if (shipmentId) {
    const { data } = await supabase
      .from("shipments")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", shipmentId)
      .maybeSingle();
    if (!data?.id) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Shipment not found.");
    return String(data.id);
  }

  const orderKey = (input.orderId ?? "").trim();
  if (!orderKey) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Load an order to preview the shipping label.");
  }

  const byId = await supabase
    .from("orders")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", orderKey)
    .maybeSingle();
  let orderId = byId.data?.id ? String(byId.data.id) : "";
  if (!orderId) {
    for (const candidate of orderNumberCandidates(orderKey)) {
      const byNumber = await supabase
        .from("orders")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("order_number", candidate)
        .maybeSingle();
      if (byNumber.data?.id) {
        orderId = String(byNumber.data.id);
        break;
      }
    }
  }
  if (!orderId) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found.");

  const shipment = await supabase
    .from("shipments")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!shipment.data?.id) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "No shipment for that order.");
  return String(shipment.data.id);
}

function applyPaymentPreview(data: PackingLabelData, paymentPreview?: string | null) {
  if (paymentPreview !== "COD" && paymentPreview !== "PREPAID") return data;
  return {
    ...data,
    paymentMode: paymentPreview,
    paymentMethod: paymentPreview,
  };
}

export async function renderSampleCustomShippingLabel(
  supabase: SupabaseClient,
  organizationId: string,
  input: CustomLabelRequest
) {
  const stored = input.template
    ? parseLabelTemplate(input.template)
    : await getLabelTemplate(supabase, organizationId);
  const template = selectLabelTemplate(stored, input.templateId);
  const { data: org } = await supabase
    .from("organizations")
    .select("logo_path")
    .eq("id", organizationId)
    .maybeSingle();
  const logo = await loadLogoBytes(supabase, org?.logo_path);
  const data = applyPaymentPreview(
    {
      ...SAMPLE_PACKING_DATA,
      logoBytes: logo?.bytes ?? null,
      logoMime: logo?.mime ?? null,
      logoUrl: organizationLogoUrl(org?.logo_path),
    },
    input.paymentPreview
  );
  const pdf = Buffer.from(await renderMerchantLabelPdf(template, data));
  return { shipmentId: "", template, data, pdf };
}

export async function loadCustomShippingLabel(
  supabase: SupabaseClient,
  organizationId: string,
  input: CustomLabelRequest
) {
  const shipmentId = await resolveCustomLabelShipment(supabase, organizationId, input);
  const loaded = await loadPackingLabelData(supabase, organizationId, shipmentId);
  const stored = input.template
    ? parseLabelTemplate(input.template)
    : input.templateId
      ? await getLabelTemplate(supabase, organizationId)
      : loaded.template;
  const template = selectLabelTemplate(stored, input.templateId);
  const data = applyPaymentPreview(loaded.data, input.paymentPreview);
  return { shipmentId, template, data };
}

export async function renderCustomShippingLabel(
  supabase: SupabaseClient,
  organizationId: string,
  input: CustomLabelRequest
) {
  const loaded = await loadCustomShippingLabel(supabase, organizationId, input);
  const pdf = Buffer.from(await renderMerchantLabelPdf(loaded.template, loaded.data));
  return { ...loaded, pdf };
}

export async function customLabelBarcodePng(
  supabase: SupabaseClient,
  organizationId: string,
  input: CustomLabelRequest
) {
  const loaded = await loadCustomShippingLabel(supabase, organizationId, input);
  const png = loaded.data.articleId ? await indiaPostBarcodePng(loaded.data.articleId) : null;
  return { png, articleId: loaded.data.articleId || "", shipmentId: loaded.shipmentId };
}

export async function printCustomShippingLabel(
  supabase: SupabaseClient,
  ctx: TenantContext,
  input: CustomLabelRequest
) {
  const rendered = await renderCustomShippingLabel(supabase, ctx.organizationId, input);
  const saved = await persistLabelPdf(supabase, {
    organizationId: ctx.organizationId,
    shipmentId: rendered.shipmentId,
    kind: "CUSTOM_SHIPPING",
    bytes: rendered.pdf,
    templateSnapshot: rendered.template,
  });
  const media = printMediaForPage(rendered.template.page);
  const job = await enqueueManualPrintJob(supabase, ctx, saved.id, { paperSize: media.paperSize });
  const station = await getPrintStation(supabase, ctx.organizationId);
  return {
    labelId: saved.id,
    job: { id: job.id, status: job.status, source: job.source, paperSize: media.paperSize },
    connected: station.connected,
    downloadPath: `/api/v1/labels/${saved.id}/download`,
    message: station.connected
      ? "Custom shipping label sent to the printer."
      : "Printer unavailable. Opening the shipping label PDF.",
    template: rendered.template satisfies LabelTemplate,
  };
}
