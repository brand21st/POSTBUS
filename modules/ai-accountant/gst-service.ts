import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { writeAccountingAudit } from "@/modules/ai-accountant/audit";
import { loadBooksContext } from "@/modules/ai-accountant/books-context";
import { computeGst, stateCodeFromName } from "@/modules/ai-accountant/gst";
import { buildGstr1, buildGstr3b, type CreditLedger, type SupplyLine } from "@/modules/ai-accountant/gst-returns";
import { paiseFromNumeric } from "@/modules/ai-accountant/money";
import { istDate, istDayEndExclusiveUtc, istDayStartUtc, monthPeriod } from "@/modules/ai-accountant/period";

const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{13}$/;

export const taxProfileSchema = z.object({
  productId: z.string().uuid(),
  hsnSac: z.string().trim().regex(/^\d{4,8}$/, "HSN/SAC must be 4 to 8 digits.").optional().nullable(),
  rateBps: z.number().int().min(0).max(4000),
  cessBps: z.number().int().min(0).max(10000).default(0),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function listTaxProfiles(supabase: SupabaseClient, organizationId: string) {
  const [{ data: products }, { data: profiles }, { data: costs }] = await Promise.all([
    supabase.from("products").select("id, name, sku, price, active").eq("organization_id", organizationId).order("name").limit(2000),
    supabase
      .from("product_tax_profiles")
      .select("product_id, hsn_sac, rate_bps, cess_bps, effective_from")
      .eq("organization_id", organizationId)
      .order("effective_from", { ascending: true }),
    supabase
      .from("product_costs")
      .select("product_id, unit_cost, effective_from, created_at")
      .eq("organization_id", organizationId)
      .order("effective_from", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of profiles ?? []) latest.set(row.product_id, row);
  const latestCost = new Map<string, number>();
  for (const row of costs ?? []) if (row.product_id) latestCost.set(row.product_id, paiseFromNumeric(row.unit_cost));
  const rows = (products ?? []).map((product) => ({
    ...product,
    profile: latest.get(product.id) ?? null,
    unitCostPaise: latestCost.get(product.id) ?? null,
  }));
  return { products: rows, missing: rows.filter((row) => !row.profile && row.active).length };
}

export async function saveTaxProfile(supabase: SupabaseClient, organizationId: string, raw: unknown, userId: string) {
  const body = taxProfileSchema.parse(raw);
  const { data: product } = await supabase
    .from("products")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", body.productId)
    .maybeSingle();
  if (!product) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Product not found.");
  const { error } = await supabase.from("product_tax_profiles").upsert(
    {
      organization_id: organizationId,
      product_id: body.productId,
      hsn_sac: body.hsnSac ?? null,
      rate_bps: body.rateBps,
      cess_bps: body.cessBps,
      effective_from: body.effectiveFrom ?? istDate(),
    },
    { onConflict: "organization_id,product_id,effective_from" }
  );
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not save the tax profile.");
  await writeAccountingAudit(supabase, {
    organizationId,
    actorId: userId,
    action: "tax_profile.saved",
    targetType: "product",
    targetId: body.productId,
    metadata: { rateBps: body.rateBps, hsn: body.hsnSac ?? null },
  });
  return { saved: true };
}

/** Bulk map "sku,hsn,rate%" lines (CSV paste) to product tax profiles. */
export async function importTaxProfilesCsv(supabase: SupabaseClient, organizationId: string, text: string, userId: string) {
  const { data: products } = await supabase.from("products").select("id, sku").eq("organization_id", organizationId).limit(10000);
  const bySku = new Map((products ?? []).map((row) => [String(row.sku).trim().toLowerCase(), row.id as string]));
  const today = istDate();
  const rows: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const [sku, hsn, rate] = line.split(",").map((cell) => cell?.trim().replace(/^"|"$/g, "") ?? "");
    if (!sku || /^sku$/i.test(sku)) return;
    const productId = bySku.get(sku.toLowerCase());
    const ratePct = Number(String(rate).replace("%", ""));
    if (!productId) return errors.push(`Line ${index + 1}: SKU ${sku} not found.`);
    if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 40) return errors.push(`Line ${index + 1}: rate ${rate} is invalid.`);
    if (hsn && !/^\d{4,8}$/.test(hsn)) return errors.push(`Line ${index + 1}: HSN ${hsn} is invalid.`);
    rows.push({
      organization_id: organizationId,
      product_id: productId,
      hsn_sac: hsn || null,
      rate_bps: Math.round(ratePct * 100),
      effective_from: today,
    });
  });
  if (rows.length) {
    const { error } = await supabase.from("product_tax_profiles").upsert(rows, { onConflict: "organization_id,product_id,effective_from" });
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not save tax profiles.");
  }
  await writeAccountingAudit(supabase, { organizationId, actorId: userId, action: "tax_profile.imported", metadata: { saved: rows.length, errors: errors.length } });
  return { saved: rows.length, errors: errors.slice(0, 50) };
}

/** Largest-remainder allocation of a total across weights (integers). */
export function allocate(totalPaise: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? totalPaise : 0));
  const raw = weights.map((w) => (totalPaise * w) / sum);
  const out = raw.map(Math.floor);
  let rest = totalPaise - out.reduce((a, b) => a + b, 0);
  const order = raw.map((value, index) => ({ index, frac: value - Math.floor(value) })).sort((a, b) => b.frac - a.frac);
  for (const { index } of order) {
    if (rest <= 0) break;
    out[index]! += 1;
    rest -= 1;
  }
  return out;
}

type RateInfo = { rateBps: number; hsn: string | null };

/** Turns one order into GST supply lines; goods value is scaled to the order total. */
export function orderSupplyLines(input: {
  order: { id: string; orderNumber: string; date: string; totalPaise: number; shippingPaise: number; customerGstin: string | null };
  lines: Array<{ sku: string | null; quantity: number; unitPricePaise: number }>;
  rateForSku: (sku: string | null) => RateInfo | null;
  merchantState: string;
  placeOfSupply: string | null;
  inclusive: boolean;
  isReturn: boolean;
}): { lines: SupplyLine[]; missing: string | null } {
  if (!input.placeOfSupply) return { lines: [], missing: "place_of_supply" };
  const rates = input.lines.map((line) => input.rateForSku(line.sku));
  if (!input.lines.length || rates.some((rate) => !rate)) return { lines: [], missing: "tax_rate" };
  const goodsPaise = Math.max(0, input.order.totalPaise - input.order.shippingPaise);
  const shares = allocate(goodsPaise, input.lines.map((line) => line.unitPricePaise * line.quantity));
  const principal = rates.reduce((best, rate) => (rate!.rateBps > best!.rateBps ? rate : best), rates[0])!;
  const parts: Array<{ amount: number; rate: RateInfo }> = shares.map((amount, i) => ({ amount, rate: rates[i]! }));
  // Shipping billed with goods is a composite supply taxed at the principal supply's rate.
  if (input.order.shippingPaise > 0) parts.push({ amount: input.order.shippingPaise, rate: principal });
  const out: SupplyLine[] = [];
  for (const part of parts) {
    if (part.amount <= 0) continue;
    const gst = computeGst({
      amountPaise: part.amount,
      inclusive: input.inclusive,
      rateBps: part.rate.rateBps,
      merchantState: input.merchantState,
      placeOfSupplyState: input.placeOfSupply,
    });
    out.push({
      orderId: input.order.id,
      orderNumber: input.order.orderNumber,
      date: input.order.date,
      placeOfSupply: input.placeOfSupply,
      customerGstin: input.order.customerGstin,
      hsn: part.rate.hsn,
      rateBps: part.rate.rateBps,
      taxablePaise: gst.taxablePaise,
      cgstPaise: gst.cgstPaise,
      sgstPaise: gst.sgstPaise,
      igstPaise: gst.igstPaise,
      isReturn: input.isReturn,
    });
  }
  return { lines: out, missing: null };
}

function customerGstinFrom(metadata: unknown): string | null {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const candidates = [meta.customer_gstin, meta.gstin, (meta.billing_address as Record<string, unknown> | undefined)?.gstin];
  for (const value of candidates) {
    const gstin = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (GSTIN_RE.test(gstin)) return gstin;
  }
  return null;
}

async function supplyLinesForMonth(supabase: SupabaseClient, organizationId: string, month: { from: string; to: string }) {
  const ctx = await loadBooksContext(supabase, organizationId);
  const { data: settings } = await supabase
    .from("accounting_settings")
    .select("default_rate_bps, default_hsn")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const fromUtc = istDayStartUtc(month.from);
  const toUtc = istDayEndExclusiveUtc(month.to);
  const [{ data: booked }, { data: returned }] = await Promise.all([
    supabase
      .from("shipments")
      .select("order_id, booked_at, status, shipping_address_id")
      .eq("organization_id", organizationId)
      .gte("booked_at", fromUtc)
      .lt("booked_at", toUtc)
      .not("status", "in", "(DRAFT,VALIDATING,QUEUED,BOOKING,FAILED,CANCELLED,RECOVERY_REQUIRED)")
      .limit(5000),
    supabase
      .from("shipments")
      .select("order_id, updated_at, status, shipping_address_id")
      .eq("organization_id", organizationId)
      .eq("status", "RTO")
      .gte("updated_at", fromUtc)
      .lt("updated_at", toUtc)
      .limit(5000),
  ]);
  const events = [
    ...(booked ?? []).map((row) => ({ orderId: row.order_id as string, at: row.booked_at as string, addressId: row.shipping_address_id as string | null, isReturn: false })),
    ...(returned ?? []).map((row) => ({ orderId: row.order_id as string, at: row.updated_at as string, addressId: row.shipping_address_id as string | null, isReturn: true })),
  ];
  const orderIds = [...new Set(events.map((event) => event.orderId))];
  const orders = new Map<string, Record<string, unknown>>();
  const lineItems = new Map<string, Array<{ sku: string | null; quantity: number; unitPricePaise: number }>>();
  for (let i = 0; i < orderIds.length; i += 500) {
    const ids = orderIds.slice(i, i + 500);
    const [{ data: orderRows }, { data: items }] = await Promise.all([
      supabase.from("orders").select("id, order_number, total_amount, shipping_amount, shipping_address_id, metadata").eq("organization_id", organizationId).in("id", ids),
      supabase.from("order_line_items").select("order_id, sku, quantity, unit_price").eq("organization_id", organizationId).in("order_id", ids),
    ]);
    for (const row of orderRows ?? []) orders.set(row.id, row);
    for (const row of items ?? []) {
      const list = lineItems.get(row.order_id) ?? [];
      list.push({ sku: row.sku, quantity: Number(row.quantity ?? 1), unitPricePaise: paiseFromNumeric(row.unit_price) });
      lineItems.set(row.order_id, list);
    }
  }
  const addressIds = [...new Set(events.map((e) => e.addressId ?? (orders.get(e.orderId)?.shipping_address_id as string | null)).filter((id): id is string => Boolean(id)))];
  const states = new Map<string, string | null>();
  for (let i = 0; i < addressIds.length; i += 500) {
    const { data } = await supabase.from("addresses").select("id, state").eq("organization_id", organizationId).in("id", addressIds.slice(i, i + 500));
    for (const row of data ?? []) states.set(row.id, stateCodeFromName(row.state));
  }
  const { data: products } = await supabase.from("products").select("id, sku").eq("organization_id", organizationId).limit(10000);
  const { data: profiles } = await supabase
    .from("product_tax_profiles")
    .select("product_id, hsn_sac, rate_bps, effective_from")
    .eq("organization_id", organizationId)
    .lte("effective_from", month.to)
    .order("effective_from", { ascending: true });
  const profileByProduct = new Map<string, RateInfo>();
  for (const row of profiles ?? []) profileByProduct.set(row.product_id, { rateBps: Number(row.rate_bps), hsn: row.hsn_sac });
  const rateBySku = new Map<string, RateInfo>();
  for (const product of products ?? []) {
    const profile = profileByProduct.get(product.id);
    if (profile) rateBySku.set(String(product.sku).trim().toLowerCase(), profile);
  }
  const fallback: RateInfo | null =
    settings?.default_rate_bps != null ? { rateBps: Number(settings.default_rate_bps), hsn: settings.default_hsn ?? null } : null;
  const rateForSku = (sku: string | null) => (sku ? rateBySku.get(sku.trim().toLowerCase()) : undefined) ?? fallback;

  const supplies: SupplyLine[] = [];
  const missing: Record<string, number> = {};
  const seen = new Set<string>();
  for (const event of events) {
    const key = `${event.orderId}:${event.isReturn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const order = orders.get(event.orderId);
    if (!order) continue;
    const addressId = event.addressId ?? (order.shipping_address_id as string | null);
    const result = orderSupplyLines({
      order: {
        id: event.orderId,
        orderNumber: String(order.order_number ?? event.orderId),
        date: istDate(event.at),
        totalPaise: paiseFromNumeric(order.total_amount as string),
        shippingPaise: paiseFromNumeric(order.shipping_amount as string),
        customerGstin: customerGstinFrom(order.metadata),
      },
      lines: lineItems.get(event.orderId) ?? [],
      rateForSku,
      merchantState: ctx.merchantState ?? "",
      placeOfSupply: addressId ? states.get(addressId) ?? null : null,
      inclusive: ctx.taxInclusive,
      isReturn: event.isReturn,
    });
    if (result.missing) missing[result.missing] = (missing[result.missing] ?? 0) + 1;
    supplies.push(...result.lines);
  }
  return { ctx, supplies, missing };
}

async function itcForMonth(supabase: SupabaseClient, organizationId: string, month: { from: string; to: string }): Promise<CreditLedger> {
  const itc: CreditLedger = { cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
  const { data: lines } = await supabase.rpc("accounting_account_totals", { p_org: organizationId, p_from: month.from, p_to: month.to });
  for (const row of (lines ?? []) as Array<{ system_key: string | null; debit_paise: number; credit_paise: number }>) {
    const net = Number(row.debit_paise) - Number(row.credit_paise);
    if (row.system_key === "gst_input_cgst") itc.cgstPaise += net;
    if (row.system_key === "gst_input_sgst") itc.sgstPaise += net;
    if (row.system_key === "gst_input_igst") itc.igstPaise += net;
  }
  return { cgstPaise: Math.max(0, itc.cgstPaise), sgstPaise: Math.max(0, itc.sgstPaise), igstPaise: Math.max(0, itc.igstPaise) };
}

export const gstDraftSchema = z.object({
  type: z.enum(["GSTR1", "GSTR3B"]),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2017).max(2100),
});

/** Computes a GSTR-1 or GSTR-3B draft without storing it (read-only). */
export async function computeGstReturn(supabase: SupabaseClient, organizationId: string, raw: unknown) {
  const input = gstDraftSchema.parse(raw);
  const month = monthPeriod(input.year, input.month);
  const ctx = await loadBooksContext(supabase, organizationId);
  if (!ctx.gstRegistered || !ctx.merchantState) {
    return { input, payload: { status: "INCOMPLETE" as const, reason: "gst_registration_required", type: input.type, period: month } };
  }
  const { supplies, missing } = await supplyLinesForMonth(supabase, organizationId, month);
  const gstr1 = buildGstr1(supplies);
  const incompleteCount = Object.values(missing).reduce((a, b) => a + b, 0);
  const body =
    input.type === "GSTR1"
      ? gstr1
      : buildGstr3b({ outward: gstr1.totals, itc: await itcForMonth(supabase, organizationId, month) });
  return {
    input,
    payload: {
      type: input.type,
      period: month,
      status: incompleteCount ? ("NEEDS_REVIEW" as const) : ("DRAFT" as const),
      missing,
      incompleteCount,
      generatedAt: new Date().toISOString(),
      disclaimer: "Draft prepared from PostBus data. Review with your tax advisor before filing on the GST portal.",
      ...body,
    },
  };
}

/** Builds and stores a GSTR-1 or GSTR-3B draft. Never files anything. */
export async function prepareGstReturn(supabase: SupabaseClient, organizationId: string, raw: unknown) {
  const { input, payload } = await computeGstReturn(supabase, organizationId, raw);
  if (payload.status === "INCOMPLETE") return payload;
  await supabase.from("gst_return_drafts").upsert(
    {
      organization_id: organizationId,
      return_type: input.type,
      period_month: input.month,
      period_year: input.year,
      status: payload.status,
      payload,
    },
    { onConflict: "organization_id,return_type,period_month,period_year" }
  );
  return payload;
}

export async function listGstDrafts(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("gst_return_drafts")
    .select("id, return_type, period_month, period_year, status, created_at, payload")
    .eq("organization_id", organizationId)
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false })
    .limit(48);
  return { drafts: data ?? [] };
}
