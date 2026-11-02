import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { paiseFromNumeric } from "@/modules/ai-accountant/money";
import { fetchShopifyOrderTax } from "@/modules/shopify/graphql/order-tax";
import { loadShopifyConnection, resolveShopifyAdminToken } from "@/modules/shopify/orders";
import type { ShopifyTaxLine, ShopifyTaxSnapshot } from "@/modules/shopify/tax-snapshot";
import { shopifySnapshotIsComplete } from "@/modules/shopify/tax-snapshot";
import { relativeInvoicePath, resolveSafeInvoicePath, saveInvoicePdf, readInvoicePdfIfPresent } from "@/modules/invoices/storage";
import { cleanSalesInvoiceSearch, salesInvoiceSearchClause, summarizeSalesInvoices } from "@/modules/sales-invoices/list";
import { loadSellerProfile } from "@/modules/sales-invoices/profile";
import { renderSalesInvoicePdf } from "@/modules/sales-invoices/pdf";
import {
  billingAfterSameAddressToggle,
  calculateSalesInvoice,
  emptyParty,
  financialYearLabel,
  partyFromAddress,
  placeOfSupply,
  type CalcLineInput,
  type CalcResult,
  type DocumentType,
  type PartySnapshot,
  type PricingMode,
  type SellerScheme,
  type TaxSource,
} from "@/modules/sales-invoices/tax";

export type SalesInvoiceSettings = {
  template: "CLASSIC" | "GST";
  prefix: string;
  financialYearStartMonth: number;
  terms: string;
  thankYou: string;
  signaturePath: string;
  showSku: boolean;
  showVariant: boolean;
  showHsn: boolean;
  showLineDiscount: boolean;
  showPaymentMethod: boolean;
  showOrderNumber: boolean;
  showShippingAddress: boolean;
  showSignature: boolean;
  autoIssue: boolean;
  autoIssueEvent: "ORDER_CREATED" | "PAYMENT_CONFIRMED" | null;
};

const DEFAULT_SETTINGS: SalesInvoiceSettings = {
  template: "CLASSIC",
  prefix: "INV",
  financialYearStartMonth: 4,
  terms: "",
  thankYou: "",
  signaturePath: "",
  showSku: true,
  showVariant: true,
  showHsn: true,
  showLineDiscount: true,
  showPaymentMethod: true,
  showOrderNumber: true,
  showShippingAddress: true,
  showSignature: true,
  autoIssue: false,
  autoIssueEvent: null,
};

function mapSettings(row: Record<string, unknown> | null): SalesInvoiceSettings {
  if (!row) return DEFAULT_SETTINGS;
  return {
    template: row.template === "GST" ? "GST" : "CLASSIC",
    prefix: String(row.prefix || "INV"),
    financialYearStartMonth: Number(row.financial_year_start_month ?? 4),
    terms: String(row.terms ?? ""),
    thankYou: String(row.thank_you ?? ""),
    signaturePath: String(row.signature_path ?? ""),
    showSku: row.show_sku !== false,
    showVariant: row.show_variant !== false,
    showHsn: row.show_hsn !== false,
    showLineDiscount: row.show_line_discount !== false,
    showPaymentMethod: row.show_payment_method !== false,
    showOrderNumber: row.show_order_number !== false,
    showShippingAddress: row.show_shipping_address !== false,
    showSignature: row.show_signature !== false,
    autoIssue: row.auto_issue === true,
    autoIssueEvent: row.auto_issue_event === "ORDER_CREATED" || row.auto_issue_event === "PAYMENT_CONFIRMED" ? row.auto_issue_event : null,
  };
}

export async function getSalesInvoiceSettings(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase.from("sales_invoice_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  return mapSettings(data as Record<string, unknown> | null);
}

export async function saveSalesInvoiceSettings(supabase: SupabaseClient, organizationId: string, input: SalesInvoiceSettings) {
  const prefix = input.prefix.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (prefix.length < 1 || prefix.length > 4) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Invoice prefix must be 1 to 4 letters or digits.");
  }
  const { error } = await supabase.from("sales_invoice_settings").upsert({
    organization_id: organizationId,
    template: input.template,
    prefix,
    financial_year_start_month: input.financialYearStartMonth || 4,
    terms: input.terms || null,
    thank_you: input.thankYou || null,
    signature_path: input.signaturePath || null,
    show_sku: input.showSku,
    show_variant: input.showVariant,
    show_hsn: input.showHsn,
    show_line_discount: input.showLineDiscount,
    show_payment_method: input.showPaymentMethod,
    show_order_number: input.showOrderNumber,
    show_shipping_address: input.showShippingAddress,
    show_signature: input.showSignature,
    auto_issue: input.autoIssue === true,
    auto_issue_event: input.autoIssue ? input.autoIssueEvent : null,
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return getSalesInvoiceSettings(supabase, organizationId);
}

function componentsFromTitles(lines: ShopifyTaxLine[]) {
  const out = { cgstPaise: 0, sgstPaise: 0, utgstPaise: 0, igstPaise: 0, cessPaise: 0, unknownPaise: 0 };
  for (const line of lines) {
    const title = line.title.toUpperCase();
    if (title.includes("CGST")) out.cgstPaise += line.amountPaise;
    else if (title.includes("UTGST")) out.utgstPaise += line.amountPaise;
    else if (title.includes("SGST")) out.sgstPaise += line.amountPaise;
    else if (title.includes("IGST")) out.igstPaise += line.amountPaise;
    else if (title.includes("CESS")) out.cessPaise += line.amountPaise;
    else out.unknownPaise += line.amountPaise;
  }
  return out;
}

async function recordEvent(supabase: SupabaseClient, organizationId: string, invoiceId: string, action: string, actorId?: string | null, detail?: unknown) {
  await supabase.from("sales_invoice_events").insert({
    organization_id: organizationId,
    invoice_id: invoiceId,
    action,
    actor_id: actorId ?? null,
    detail: detail ?? {},
  });
}

function paymentStatusOf(order: { payment_status?: string | null; amount_paid?: number | string | null; total_amount?: number | string | null }) {
  const status = String(order.payment_status ?? "").toUpperCase();
  if (status === "PAID") return "PAID" as const;
  if (status === "PARTIAL") return "PARTIAL" as const;
  const paid = paiseFromNumeric(order.amount_paid);
  const total = paiseFromNumeric(order.total_amount);
  if (paid > 0 && total > 0 && paid < total) return "PARTIAL" as const;
  if (paid > 0 && paid >= total && total > 0) return "PAID" as const;
  return "UNPAID" as const;
}

export async function createSalesInvoiceFromOrder(supabase: SupabaseClient, organizationId: string, orderId: string, actorId?: string | null) {
  const { data: existing } = await supabase
    .from("sales_invoices")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("order_id", orderId)
    .eq("document_kind", "SALES")
    .neq("status", "CANCELLED")
    .maybeSingle();
  if (existing?.id) return getSalesInvoice(supabase, organizationId, String(existing.id));

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, source, source_order_id, order_number, created_at, subtotal, discount, shipping_amount, tax_amount, total_amount, payment_status, amount_paid, cod_amount, currency, metadata, customers(name, phone, email), billing_address:addresses!billing_address_id(*), shipping_address:addresses!shipping_address_id(*), order_line_items(id, title, variant, sku, quantity, unit_price)")
    .eq("organization_id", organizationId)
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found.");

  let metadata = (order.metadata ?? {}) as Record<string, unknown>;
  if (order.source_order_id) metadata = { ...metadata, source_order_id: order.source_order_id };
  let snapshot = (metadata.shopify_tax ?? null) as ShopifyTaxSnapshot | null;
  if (order.source === "SHOPIFY" && !shopifySnapshotIsComplete(snapshot, paiseFromNumeric(order.tax_amount))) {
    snapshot = await captureShopifyTax(supabase, organizationId, metadata, snapshot);
    if (snapshot) {
      metadata = { ...metadata, shopify_tax: snapshot };
      await supabase.from("orders").update({ metadata }).eq("id", orderId).eq("organization_id", organizationId);
    }
  }

  const seller = await loadSellerProfile(supabase, organizationId);
  const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
  const shippingRow = (Array.isArray(order.shipping_address) ? order.shipping_address[0] : order.shipping_address) as Record<string, unknown> | null;
  const billingRow = (Array.isArray(order.billing_address) ? order.billing_address[0] : order.billing_address) as Record<string, unknown> | null;
  const shipping = partyFromAddress(shippingRow, customer?.name ?? "");
  if (!shipping.phone) shipping.phone = String(customer?.phone ?? "");
  if (!shipping.email) shipping.email = String(customer?.email ?? "");
  const billingAddress = billingRow;
  const billing = billingAddress ? partyFromAddress(billingAddress, customer?.name ?? "") : { ...emptyParty(), name: String(customer?.name ?? "") };
  if (!billing.email) billing.email = String(customer?.email ?? "");
  const pos = placeOfSupply({
    shipState: shipping.state,
    billState: billing.state,
    shipCode: shipping.stateCode,
    billCode: billing.stateCode,
  });
  const taxSource: TaxSource = order.source === "SHOPIFY" && snapshot ? "IMPORTED" : order.source === "SHOPIFY" ? "IMPORTED" : "MANUAL";
  const pricing: PricingMode = snapshot?.taxesIncluded ? "INCLUSIVE" : "EXCLUSIVE";
  const lines = buildLines(order.order_line_items as Array<Record<string, unknown>> | null, snapshot, taxSource);
  const calc = calculateSalesInvoice({
    scheme: seller.scheme,
    taxSource,
    pricing,
    supplierStateCode: seller.stateCode || null,
    posStateCode: pos.code,
    lines,
    orderDiscountPaise: taxSource === "IMPORTED" ? 0 : paiseFromNumeric(order.discount),
    shippingAmountPaise: paiseFromNumeric(order.shipping_amount),
    shippingTaxable: false,
    shippingRateBps: null,
    importedTaxesIncluded: snapshot?.taxesIncluded ?? null,
    importedHeaderTaxPaise: paiseFromNumeric(order.tax_amount),
    importedGrandTotalPaise: taxSource === "IMPORTED" ? paiseFromNumeric(order.total_amount) : null,
  });
  const status = calc.status === "OK" ? "DRAFT" : "REVIEW";
  const inserted = await supabase
    .from("sales_invoices")
    .insert({
      organization_id: organizationId,
      order_id: orderId,
      source: order.source ?? "MANUAL",
      document_kind: "SALES",
      document_type: calc.documentType,
      tax_source: taxSource,
      pricing,
      status,
      payment_status: paymentStatusOf(order),
      payment_method: paymentMethod(metadata, order.payment_status),
      currency: order.currency || "INR",
      seller_snapshot: seller,
      billing_snapshot: billing,
      shipping_snapshot: shipping,
      pos_basis: pos.basis,
      pos_state_code: pos.code,
      pos_state_name: pos.stateName,
      ...moneyColumns(calc),
      amount_paid_paise: paiseFromNumeric(order.amount_paid),
      cod_collect_paise: paiseFromNumeric(order.cod_amount),
      review_reasons: calc.reasons,
      created_by: actorId ?? null,
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, inserted.error?.message || "Could not create the invoice.");
  await replaceLines(supabase, organizationId, inserted.data.id, calc.lines);
  await recordEvent(supabase, organizationId, inserted.data.id, "invoice.created", actorId, { orderId });
  return getSalesInvoice(supabase, organizationId, inserted.data.id);
}

function paymentMethod(metadata: Record<string, unknown>, paymentStatus?: string | null) {
  const payment = metadata.shopifyPayment as { gateway?: string; gateways?: string[] } | undefined;
  const gateway = payment?.gateway || payment?.gateways?.[0];
  if (gateway) return String(gateway).slice(0, 80);
  const status = String(paymentStatus ?? "").toUpperCase();
  if (status === "COD") return "COD";
  if (status === "PAID") return "Prepaid";
  return status || "Other";
}

function buildLines(rows: Array<Record<string, unknown>> | null, snapshot: ShopifyTaxSnapshot | null, taxSource: TaxSource): CalcLineInput[] {
  return (rows ?? []).map((row) => {
    const quantity = Number(row.quantity ?? 1);
    const unitPricePaise = paiseFromNumeric(row.unit_price as string | number | null | undefined);
    const match = snapshot?.lineTaxes.find((line) => (row.sku && line.sku === row.sku) || line.title === row.title);
    const parts = match ? componentsFromTitles(match.taxLines) : null;
    const tax = parts ? parts.cgstPaise + parts.sgstPaise + parts.utgstPaise + parts.igstPaise + parts.cessPaise : 0;
    return {
      name: String(row.title || "Item"),
      variant: (row.variant as string | null) ?? match?.variant ?? null,
      sku: (row.sku as string | null) ?? null,
      hsn: null,
      quantity,
      unit: "NOS",
      unitPricePaise,
      discountPaise: match?.discountPaise ?? 0,
      rateBps: match?.taxLines.find((line) => line.rateBps)?.rateBps ?? null,
      treatment: "TAXABLE" as const,
      sourceLineId: String(row.id),
      imported: taxSource === "IMPORTED" && parts && parts.unknownPaise === 0 ? {
        taxablePaise: Math.max(0, unitPricePaise * quantity - (match?.discountPaise ?? 0) - (snapshot?.taxesIncluded ? tax : 0)),
        ...parts,
        lineTotalPaise: snapshot?.taxesIncluded ? unitPricePaise * quantity : unitPricePaise * quantity + tax,
      } : undefined,
    };
  });
}

function moneyColumns(calc: CalcResult) {
  return {
    subtotal_paise: calc.subtotalPaise,
    discount_paise: calc.discountPaise,
    shipping_paise: calc.shippingPaise,
    taxable_paise: calc.taxablePaise,
    cgst_paise: calc.cgstPaise,
    sgst_paise: calc.sgstPaise,
    utgst_paise: calc.utgstPaise,
    igst_paise: calc.igstPaise,
    cess_paise: calc.cessPaise,
    round_off_paise: calc.roundOffPaise,
    grand_total_paise: calc.grandTotalPaise,
  };
}

async function replaceLines(supabase: SupabaseClient, organizationId: string, invoiceId: string, lines: Array<CalcResult["lines"][number] & { sourceLineId?: string }>) {
  await supabase.from("sales_invoice_lines").delete().eq("invoice_id", invoiceId).eq("organization_id", organizationId);
  if (!lines.length) return;
  const { error } = await supabase.from("sales_invoice_lines").insert(lines.map((line, index) => ({
    organization_id: organizationId,
    invoice_id: invoiceId,
    source_line_id: line.sourceLineId ?? null,
    position: index,
    name: line.name,
    variant: line.variant ?? null,
    sku: line.sku ?? null,
    hsn: line.hsn ?? null,
    quantity: line.quantity,
    unit: line.unit ?? null,
    unit_price_paise: line.unitPricePaise,
    discount_paise: line.discountPaise,
    taxable_paise: line.taxablePaise,
    rate_bps: line.rateBps,
    treatment: line.treatment,
    cgst_paise: line.cgstPaise,
    sgst_paise: line.sgstPaise,
    utgst_paise: line.utgstPaise,
    igst_paise: line.igstPaise,
    cess_paise: line.cessPaise,
    line_total_paise: line.lineTotalPaise,
  })));
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
}

async function captureShopifyTax(supabase: SupabaseClient, organizationId: string, metadata: Record<string, unknown>, current: ShopifyTaxSnapshot | null) {
  try {
    const connection = await loadShopifyConnection(supabase, organizationId);
    const token = await resolveShopifyAdminToken(connection);
    const sourceId = String((metadata.shopify_order_id ?? metadata.source_order_id ?? "") || "");
    if (!connection?.shop_domain || !token || !sourceId) return current;
    return await fetchShopifyOrderTax(connection.shop_domain, token, sourceId);
  } catch {
    return current;
  }
}

export type DraftPatch = {
  billing?: PartySnapshot;
  shipping?: PartySnapshot;
  sameAsShipping?: boolean;
  explicitBilling?: PartySnapshot | null;
  pricing?: PricingMode;
  lines?: CalcLineInput[];
  orderDiscountPaise?: number;
  shippingAmountPaise?: number;
  shippingTaxable?: boolean;
  shippingRateBps?: number | null;
  confirmRecalculate?: boolean;
  paymentMethod?: string;
};

export async function updateSalesInvoicePayment(
  supabase: SupabaseClient,
  organizationId: string,
  invoiceId: string,
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID",
  actorId?: string | null
) {
  const current = await getSalesInvoice(supabase, organizationId, invoiceId);
  const { error } = await supabase
    .from("sales_invoices")
    .update({ payment_status: paymentStatus })
    .eq("id", invoiceId)
    .eq("organization_id", organizationId);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  await recordEvent(supabase, organizationId, invoiceId, "invoice.payment_updated", actorId, {
    from: current.paymentStatus,
    to: paymentStatus,
  });
  return getSalesInvoice(supabase, organizationId, invoiceId);
}

export async function updateSalesInvoiceDraft(supabase: SupabaseClient, organizationId: string, invoiceId: string, patch: DraftPatch, actorId?: string | null) {
  const current = await getSalesInvoice(supabase, organizationId, invoiceId);
  if (current.status === "ISSUED" || current.status === "CANCELLED") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Issued invoices cannot be edited. Create a credit note instead.");
  }
  if (current.taxSource === "IMPORTED" && patch.lines && !patch.confirmRecalculate) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This invoice keeps the Shopify tax snapshot. Confirm recalculation before editing amounts.");
  }
  const shipping = patch.shipping ?? current.shipping;
  const billing = billingAfterSameAddressToggle({
    same: patch.sameAsShipping === true,
    shipping,
    billing: patch.billing ?? current.billing,
    explicitBilling: patch.explicitBilling ?? (patch.sameAsShipping ? current.billing : null),
  });
  const seller = current.seller;
  const pos = placeOfSupply({ shipState: shipping.state, billState: billing.state, shipCode: shipping.stateCode, billCode: billing.stateCode });
  const taxSource: TaxSource = patch.confirmRecalculate ? "CALCULATED" : current.taxSource;
  const lines = (patch.lines ?? current.lines).map((line) => ({ ...line, imported: taxSource === "IMPORTED" ? line.imported : undefined }));
  const calc = calculateSalesInvoice({
    scheme: seller.scheme,
    taxSource,
    pricing: patch.pricing ?? current.pricing,
    supplierStateCode: seller.stateCode || null,
    posStateCode: pos.code,
    lines,
    orderDiscountPaise: patch.orderDiscountPaise ?? 0,
    shippingAmountPaise: patch.shippingAmountPaise ?? current.shippingPaise,
    shippingTaxable: patch.shippingTaxable ?? current.shippingTaxable,
    shippingRateBps: patch.shippingRateBps === undefined ? current.shippingRateBps : patch.shippingRateBps,
    importedTaxesIncluded: taxSource === "IMPORTED" ? current.pricing === "INCLUSIVE" : null,
    importedHeaderTaxPaise: taxSource === "IMPORTED" ? current.cgstPaise + current.sgstPaise + current.utgstPaise + current.igstPaise : null,
    importedGrandTotalPaise: taxSource === "IMPORTED" ? current.grandTotalPaise : null,
  });
  const { error } = await supabase
    .from("sales_invoices")
    .update({
      billing_snapshot: billing,
      shipping_snapshot: shipping,
      pricing: patch.pricing ?? current.pricing,
      tax_source: taxSource,
      document_type: calc.documentType,
      status: calc.status === "BLOCKED" ? "REVIEW" : calc.status === "REVIEW" ? "REVIEW" : "DRAFT",
      pos_basis: pos.basis,
      pos_state_code: pos.code,
      pos_state_name: pos.stateName,
      shipping_taxable: patch.shippingTaxable ?? current.shippingTaxable,
      shipping_rate_bps: patch.shippingRateBps === undefined ? current.shippingRateBps : patch.shippingRateBps,
      payment_method: patch.paymentMethod ?? current.paymentMethod,
      review_reasons: calc.reasons,
      ...moneyColumns(calc),
    })
    .eq("id", invoiceId)
    .eq("organization_id", organizationId);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  await replaceLines(supabase, organizationId, invoiceId, calc.lines);
  await recordEvent(supabase, organizationId, invoiceId, "invoice.edited", actorId);
  return getSalesInvoice(supabase, organizationId, invoiceId);
}

export async function issueSalesInvoice(supabase: SupabaseClient, organizationId: string, invoiceId: string, actorId?: string | null) {
  const current = await getSalesInvoice(supabase, organizationId, invoiceId);
  if (current.status === "ISSUED") return current;
  if (current.status === "CANCELLED") throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Cancelled invoices cannot be issued.");
  if (current.documentKind === "CREDIT_NOTE") {
    if (current.lines.some((line) => line.quantity >= 0)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "A credit note quantity cannot exceed the original invoice.");
    }
    return finalizeIssued(supabase, organizationId, current, actorId, current.documentType, []);
  }
  const calc = calculateSalesInvoice(calcInputFromInvoice(current));
  if (calc.status !== "OK") {
    await supabase.from("sales_invoices").update({ status: "REVIEW", review_reasons: calc.reasons, document_type: calc.documentType, ...moneyColumns(calc) }).eq("id", invoiceId).eq("organization_id", organizationId);
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Invoice needs review: ${calc.reasons.join(", ")}`);
  }
  if (calc.documentType === "TAX_INVOICE") {
    if (!current.seller.gstin || !current.seller.legalName || !current.seller.line1 || !current.posStateCode) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "A tax invoice needs the seller GSTIN, legal name, address, and place of supply.");
    }
  }
  return finalizeIssued(supabase, organizationId, current, actorId, calc.documentType, [], calc);
}

async function finalizeIssued(
  supabase: SupabaseClient,
  organizationId: string,
  current: SalesInvoiceRecord,
  actorId: string | null | undefined,
  documentType: DocumentType,
  reasons: string[],
  calc?: CalcResult
) {
  const settings = await getSalesInvoiceSettings(supabase, organizationId);
  const series = current.documentKind === "CREDIT_NOTE" ? "CN" : "INV";
  const { data: number, error: numberError } = await supabase.rpc("allocate_sales_invoice_number", {
    p_organization_id: organizationId,
    p_series: series,
    p_prefix: settings.prefix,
  });
  if (numberError || !number) throw new AppError(ERROR_CODES.VALIDATION_ERROR, numberError?.message || "Could not allocate an invoice number.");
  const invoiceDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const { error } = await supabase
    .from("sales_invoices")
    .update({
      status: "ISSUED",
      invoice_number: String(number),
      financial_year: financialYearLabel(new Date(), settings.financialYearStartMonth),
      invoice_date: invoiceDate,
      issued_at: new Date().toISOString(),
      document_type: documentType,
      review_reasons: reasons,
      template_id: settings.template,
      ...(calc ? moneyColumns(calc) : {
        subtotal_paise: current.lines.reduce((sum, line) => sum + line.unitPricePaise * line.quantity, 0),
        discount_paise: current.lines.reduce((sum, line) => sum + line.discountPaise, 0),
        taxable_paise: current.lines.reduce((sum, line) => sum + line.taxablePaise, 0),
        cgst_paise: current.lines.reduce((sum, line) => sum + line.cgstPaise, 0),
        sgst_paise: current.lines.reduce((sum, line) => sum + line.sgstPaise, 0),
        utgst_paise: current.lines.reduce((sum, line) => sum + line.utgstPaise, 0),
        igst_paise: current.lines.reduce((sum, line) => sum + line.igstPaise, 0),
        cess_paise: current.lines.reduce((sum, line) => sum + line.cessPaise, 0),
        grand_total_paise: current.lines.reduce((sum, line) => sum + line.lineTotalPaise, 0) - current.shippingPaise,
      }),
    })
    .eq("id", current.id)
    .eq("organization_id", organizationId)
    .eq("status", current.status);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  await recordEvent(supabase, organizationId, current.id, "invoice.issued", actorId, { invoiceNumber: number });
  const issued = await getSalesInvoice(supabase, organizationId, current.id);
  await writeSalesInvoicePdf(supabase, organizationId, issued, actorId);
  return getSalesInvoice(supabase, organizationId, current.id);
}

function calcInputFromInvoice(current: SalesInvoiceRecord): Parameters<typeof calculateSalesInvoice>[0] {
  return {
    scheme: current.seller.scheme,
    taxSource: current.taxSource,
    pricing: current.pricing,
    supplierStateCode: current.seller.stateCode || null,
    posStateCode: current.posStateCode,
    lines: current.lines,
    orderDiscountPaise: 0,
    shippingAmountPaise: current.shippingPaise,
    shippingTaxable: current.shippingTaxable,
    shippingRateBps: current.shippingRateBps,
    importedTaxesIncluded: current.taxSource === "IMPORTED" ? current.pricing === "INCLUSIVE" : null,
    importedHeaderTaxPaise: current.taxSource === "IMPORTED" ? current.cgstPaise + current.sgstPaise + current.utgstPaise + current.igstPaise + current.cessPaise : null,
    importedGrandTotalPaise: current.taxSource === "IMPORTED" ? current.grandTotalPaise : null,
  };
}

export async function cancelSalesInvoice(supabase: SupabaseClient, organizationId: string, invoiceId: string, actorId?: string | null) {
  const current = await getSalesInvoice(supabase, organizationId, invoiceId);
  if (current.status !== "ISSUED") throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Only an issued invoice can be cancelled.");
  const { error } = await supabase.from("sales_invoices").update({ status: "CANCELLED" }).eq("id", invoiceId).eq("organization_id", organizationId);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  await recordEvent(supabase, organizationId, invoiceId, "invoice.cancelled", actorId);
  return getSalesInvoice(supabase, organizationId, invoiceId);
}

export async function createCreditNote(supabase: SupabaseClient, organizationId: string, invoiceId: string, actorId?: string | null) {
  const original = await getSalesInvoice(supabase, organizationId, invoiceId);
  if (original.status !== "ISSUED" || original.documentKind !== "SALES") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Credit notes are created from an issued sales invoice.");
  }
  const lines = original.lines.map((line) => ({
    ...line,
    quantity: -Math.abs(line.quantity),
    imported: line.imported ? {
      taxablePaise: line.imported.taxablePaise,
      cgstPaise: line.imported.cgstPaise,
      sgstPaise: line.imported.sgstPaise,
      utgstPaise: line.imported.utgstPaise,
      igstPaise: line.imported.igstPaise,
      cessPaise: line.imported.cessPaise,
      lineTotalPaise: line.imported.lineTotalPaise,
    } : undefined,
  }));
  const inserted = await supabase.from("sales_invoices").insert({
    organization_id: organizationId,
    order_id: original.orderId,
    original_invoice_id: original.id,
    document_kind: "CREDIT_NOTE",
    source: original.source,
    document_type: original.documentType,
    tax_source: original.taxSource,
    pricing: original.pricing,
    status: "DRAFT",
    payment_status: original.paymentStatus,
    payment_method: original.paymentMethod,
    currency: original.currency,
    seller_snapshot: original.seller,
    billing_snapshot: original.billing,
    shipping_snapshot: original.shipping,
    pos_basis: original.posBasis,
    pos_state_code: original.posStateCode,
    pos_state_name: original.posStateName,
    shipping_paise: original.shippingPaise,
    shipping_taxable: original.shippingTaxable,
    shipping_rate_bps: original.shippingRateBps,
    created_by: actorId ?? null,
  }).select("id").single();
  if (inserted.error || !inserted.data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, inserted.error?.message || "Could not create the credit note.");
  await replaceLines(supabase, organizationId, inserted.data.id, lines.map((line) => ({
    ...line,
    taxablePaise: -Math.abs(line.taxablePaise),
    cgstPaise: -Math.abs(line.cgstPaise),
    sgstPaise: -Math.abs(line.sgstPaise),
    utgstPaise: -Math.abs(line.utgstPaise),
    igstPaise: -Math.abs(line.igstPaise),
    cessPaise: -Math.abs(line.cessPaise),
    lineTotalPaise: -Math.abs(line.lineTotalPaise),
  })));
  await recordEvent(supabase, organizationId, inserted.data.id, "credit_note.created", actorId, { originalInvoiceId: original.id });
  await recordEvent(supabase, organizationId, original.id, "credit_note.created", actorId, { creditNoteId: inserted.data.id });
  return issueSalesInvoice(supabase, organizationId, inserted.data.id, actorId);
}

export async function writeSalesInvoicePdf(supabase: SupabaseClient, organizationId: string, invoice: SalesInvoiceRecord, actorId?: string | null) {
  const settings = await getSalesInvoiceSettings(supabase, organizationId);
  const { data: org } = await supabase.from("organizations").select("logo_path").eq("id", organizationId).maybeSingle();
  const { loadLogoBytes } = await import("@/modules/labels/packing-data");
  const logo = await loadLogoBytes(supabase, org?.logo_path);
  const bytes = await renderSalesInvoicePdf({ invoice, settings, logo: logo?.bytes ?? null, logoMime: logo?.mime ?? null });
  const hash = createHash("sha256").update(bytes).digest("hex");
  const relative = `sales/${relativeInvoicePath(organizationId, invoice.id)}`;
  await saveInvoicePdf({ organizationId, invoiceId: invoice.id, bytes: Buffer.from(bytes), relativePath: relative });
  await supabase.from("sales_invoices").update({ pdf_path: relative, pdf_sha256: hash, template_id: settings.template }).eq("id", invoice.id).eq("organization_id", organizationId);
  await recordEvent(supabase, organizationId, invoice.id, "invoice.pdf_generated", actorId, { sha256: hash });
  return { bytes, filename: `${invoice.invoiceNumber || invoice.id}.pdf`, relative };
}

export async function loadSalesInvoicePdf(supabase: SupabaseClient, organizationId: string, invoiceId: string) {
  const invoice = await getSalesInvoice(supabase, organizationId, invoiceId);
  if (invoice.pdfPath) {
    const existing = await readInvoicePdfIfPresent({ relativePath: invoice.pdfPath, organizationId, invoiceId });
    if (existing) return { bytes: existing, filename: `${invoice.invoiceNumber || invoice.id}.pdf` };
  }
  if (invoice.status !== "ISSUED" && invoice.status !== "CANCELLED") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Issue the invoice before downloading the PDF.");
  }
  const rebuilt = await writeSalesInvoicePdf(supabase, organizationId, invoice);
  return { bytes: Buffer.from(rebuilt.bytes), filename: rebuilt.filename };
}

export type SalesInvoiceLine = CalcLineInput & {
  id: string;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  utgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  lineTotalPaise: number;
};

export type SalesInvoiceRecord = {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  documentKind: "SALES" | "CREDIT_NOTE";
  source: string;
  documentType: DocumentType;
  taxSource: TaxSource;
  pricing: PricingMode;
  status: "DRAFT" | "REVIEW" | "ISSUED" | "CANCELLED";
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  paymentMethod: string;
  invoiceNumber: string | null;
  financialYear: string | null;
  invoiceDate: string | null;
  currency: string;
  seller: SellerSnapshot;
  billing: PartySnapshot;
  shipping: PartySnapshot;
  posBasis: "SHIP_TO" | "BILL_TO" | null;
  posStateCode: string | null;
  posStateName: string | null;
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  shippingTaxable: boolean;
  shippingRateBps: number | null;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  utgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  roundOffPaise: number;
  grandTotalPaise: number;
  amountPaidPaise: number;
  codCollectPaise: number;
  reviewReasons: string[];
  pdfPath: string | null;
  lines: SalesInvoiceLine[];
  createdAt: string;
};

type SellerSnapshot = {
  scheme: SellerScheme;
  gstin: string;
  legalName: string;
  tradeName: string;
  pan: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  phone: string;
  email: string;
  website: string;
};

function asParty(value: unknown): PartySnapshot {
  const row = (value ?? {}) as Partial<PartySnapshot>;
  return { ...emptyParty(), ...row };
}

function mapInvoice(row: Record<string, unknown>, lines: SalesInvoiceLine[] = []): SalesInvoiceRecord {
  const order = (Array.isArray(row.orders) ? row.orders[0] : row.orders) as { order_number?: string; customers?: { name?: string } | { name?: string }[] } | null;
  const customer = order?.customers;
  const customerName = Array.isArray(customer) ? customer[0]?.name : customer?.name;
  const seller = (row.seller_snapshot ?? {}) as SellerSnapshot;
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    orderNumber: String(order?.order_number ?? ""),
    customerName: String(asParty(row.billing_snapshot).name || customerName || ""),
    documentKind: row.document_kind === "CREDIT_NOTE" ? "CREDIT_NOTE" : "SALES",
    source: String(row.source ?? "MANUAL"),
    documentType: (row.document_type as DocumentType) ?? "COMMERCIAL_INVOICE",
    taxSource: (row.tax_source as TaxSource) ?? "MANUAL",
    pricing: row.pricing === "INCLUSIVE" ? "INCLUSIVE" : "EXCLUSIVE",
    status: row.status as SalesInvoiceRecord["status"],
    paymentStatus: row.payment_status as SalesInvoiceRecord["paymentStatus"],
    paymentMethod: String(row.payment_method ?? ""),
    invoiceNumber: row.invoice_number ? String(row.invoice_number) : null,
    financialYear: row.financial_year ? String(row.financial_year) : null,
    invoiceDate: row.invoice_date ? String(row.invoice_date) : null,
    currency: String(row.currency ?? "INR"),
    seller: {
      scheme: seller.scheme ?? "UNREGISTERED",
      gstin: seller.gstin ?? "",
      legalName: seller.legalName ?? "",
      tradeName: seller.tradeName ?? "",
      pan: seller.pan ?? "",
      line1: seller.line1 ?? "",
      line2: seller.line2 ?? "",
      city: seller.city ?? "",
      state: seller.state ?? "",
      stateCode: seller.stateCode ?? "",
      pincode: seller.pincode ?? "",
      phone: seller.phone ?? "",
      email: seller.email ?? "",
      website: seller.website ?? "",
    },
    billing: asParty(row.billing_snapshot),
    shipping: asParty(row.shipping_snapshot),
    posBasis: row.pos_basis === "SHIP_TO" || row.pos_basis === "BILL_TO" ? row.pos_basis : null,
    posStateCode: row.pos_state_code ? String(row.pos_state_code) : null,
    posStateName: row.pos_state_name ? String(row.pos_state_name) : null,
    subtotalPaise: Number(row.subtotal_paise ?? 0),
    discountPaise: Number(row.discount_paise ?? 0),
    shippingPaise: Number(row.shipping_paise ?? 0),
    shippingTaxable: row.shipping_taxable === true,
    shippingRateBps: row.shipping_rate_bps == null ? null : Number(row.shipping_rate_bps),
    taxablePaise: Number(row.taxable_paise ?? 0),
    cgstPaise: Number(row.cgst_paise ?? 0),
    sgstPaise: Number(row.sgst_paise ?? 0),
    utgstPaise: Number(row.utgst_paise ?? 0),
    igstPaise: Number(row.igst_paise ?? 0),
    cessPaise: Number(row.cess_paise ?? 0),
    roundOffPaise: Number(row.round_off_paise ?? 0),
    grandTotalPaise: Number(row.grand_total_paise ?? 0),
    amountPaidPaise: Number(row.amount_paid_paise ?? 0),
    codCollectPaise: Number(row.cod_collect_paise ?? 0),
    reviewReasons: Array.isArray(row.review_reasons) ? row.review_reasons.map(String) : [],
    pdfPath: row.pdf_path ? String(row.pdf_path) : null,
    lines,
    createdAt: String(row.created_at ?? ""),
  };
}

function mapLine(row: Record<string, unknown>): SalesInvoiceLine {
  return {
    id: String(row.id),
    name: String(row.name),
    variant: (row.variant as string | null) ?? null,
    sku: (row.sku as string | null) ?? null,
    hsn: (row.hsn as string | null) ?? null,
    quantity: Number(row.quantity),
    unit: (row.unit as string | null) ?? null,
    unitPricePaise: Number(row.unit_price_paise ?? 0),
    discountPaise: Number(row.discount_paise ?? 0),
    rateBps: row.rate_bps == null ? null : Number(row.rate_bps),
    treatment: (row.treatment as SalesInvoiceLine["treatment"]) ?? "TAXABLE",
    taxablePaise: Number(row.taxable_paise ?? 0),
    cgstPaise: Number(row.cgst_paise ?? 0),
    sgstPaise: Number(row.sgst_paise ?? 0),
    utgstPaise: Number(row.utgst_paise ?? 0),
    igstPaise: Number(row.igst_paise ?? 0),
    cessPaise: Number(row.cess_paise ?? 0),
    lineTotalPaise: Number(row.line_total_paise ?? 0),
  };
}

export async function getSalesInvoice(supabase: SupabaseClient, organizationId: string, invoiceId: string) {
  const { data, error } = await supabase
    .from("sales_invoices")
    .select("*, orders(order_number, customers(name))")
    .eq("organization_id", organizationId)
    .eq("id", invoiceId)
    .maybeSingle();
  if (error || !data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Invoice not found.");
  const lines = await supabase.from("sales_invoice_lines").select("*").eq("organization_id", organizationId).eq("invoice_id", invoiceId).order("position");
  return mapInvoice(data as Record<string, unknown>, (lines.data ?? []).map((row) => mapLine(row as Record<string, unknown>)));
}

export async function listSalesInvoices(supabase: SupabaseClient, organizationId: string, query: {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  payment?: string;
  source?: string;
  documentType?: string;
  from?: string;
  to?: string;
}) {
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
  let request = supabase
    .from("sales_invoices")
    .select("*, orders(order_number, customers(name))", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (query.status) request = request.eq("status", query.status);
  if (query.payment) request = request.eq("payment_status", query.payment);
  if (query.source) request = request.eq("source", query.source);
  if (query.documentType) request = request.eq("document_type", query.documentType);
  if (query.from) request = request.gte("invoice_date", query.from);
  if (query.to) request = request.lte("invoice_date", query.to);
  const term = cleanSalesInvoiceSearch(query.search);
  if (term) {
    const { data: orders } = await supabase
      .from("orders")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("order_number", `%${term}%`)
      .limit(50);
    request = request.or(salesInvoiceSearchClause(term, (orders ?? []).map((row) => String(row.id))));
  }
  const from = (page - 1) * pageSize;
  const { data, error, count } = await request.range(from, from + pageSize - 1);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const items = (data ?? []).map((row) => mapInvoice(row as Record<string, unknown>));
  return { items, page, pageSize, total: count ?? items.length };
}

export async function salesInvoiceSummary(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase
    .from("sales_invoices")
    .select("status, grand_total_paise, cgst_paise, sgst_paise, utgst_paise, igst_paise, cess_paise, document_kind")
    .eq("organization_id", organizationId);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return summarizeSalesInvoices(data ?? []);
}

export function salesInvoiceRelativePath(organizationId: string, invoiceId: string) {
  return `sales/${relativeInvoicePath(organizationId, invoiceId)}`;
}

export function assertSalesInvoicePath(relativePath: string, organizationId: string) {
  return resolveSafeInvoicePath(relativePath, organizationId);
}
