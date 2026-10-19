import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { ensureChartOfAccounts } from "@/modules/ai-accountant/chart";
import { loadBooksContext, type BooksContext } from "@/modules/ai-accountant/books-context";
import { stateCodeFromName } from "@/modules/ai-accountant/gst";
import {
  assertBalanced,
  codRemittanceEntry,
  cogsEntry,
  orderCogsPaise,
  inclusiveGst,
  orderReturnEntry,
  orderSaleEntry,
  platformPaymentEntry,
  shipmentChargeEntry,
  splitTax,
  ZERO_GST,
  type GstSplit,
  type PostingEntry,
  type PostingLine,
} from "@/modules/ai-accountant/ledger/posting-rules";
import { paiseFromNumeric } from "@/modules/ai-accountant/money";
import { istDate, istDayEndExclusiveUtc, istDayStartUtc } from "@/modules/ai-accountant/period";

const SYNC_BATCH = 2000;
const NOT_DISPATCHED = new Set(["DRAFT", "VALIDATING", "QUEUED", "BOOKING", "FAILED", "CANCELLED", "RECOVERY_REQUIRED"]);

function toRpcLines(lines: PostingLine[]) {
  return lines.map((line) => ({
    account_key: line.accountKey,
    debit_paise: line.debitPaise,
    credit_paise: line.creditPaise,
    memo: line.memo ?? null,
    party: line.party ?? null,
    gst_component: line.gstComponent ?? null,
  }));
}

export async function postEntry(
  supabase: SupabaseClient,
  organizationId: string,
  entry: PostingEntry,
  options?: { createdBy?: string | null; reversalOf?: string | null }
): Promise<string> {
  const checked = assertBalanced(entry);
  const { data, error } = await supabase.rpc("accounting_post_entry", {
    p_org: organizationId,
    p_entry: {
      memo: checked.memo,
      source_type: checked.sourceType,
      source_id: checked.sourceId,
      source_event: checked.sourceEvent,
      entry_date: checked.entryDate,
      created_by: options?.createdBy ?? null,
      reversal_of: options?.reversalOf ?? null,
    },
    p_lines: toRpcLines(checked.lines),
  });
  if (error) {
    logError("ai_accountant.post_entry_failed", {
      organizationId,
      sourceType: checked.sourceType,
      sourceEvent: checked.sourceEvent,
      message: error.message,
    });
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not post the journal entry.");
  }
  return String(data);
}

/** Output GST for an order. Uses the channel's tax when present, else the default rate. */
export function orderGst(
  ctx: BooksContext,
  order: { totalPaise: number; shippingPaise: number; taxPaise: number },
  placeOfSupply: string | null
): GstSplit {
  if (!ctx.gstRegistered) return ZERO_GST;
  if (order.taxPaise > 0) return splitTax(order.taxPaise, ctx.merchantState, placeOfSupply);
  if (ctx.defaultRateBps > 0 && ctx.taxInclusive) {
    return inclusiveGst(Math.max(0, order.totalPaise - order.shippingPaise), ctx.defaultRateBps, ctx.merchantState, placeOfSupply)
      .gst;
  }
  return ZERO_GST;
}

async function existingSourceKeys(supabase: SupabaseClient, organizationId: string, sourceType: string, ids: string[]) {
  const keys = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await supabase
      .from("journal_entries")
      .select("source_id, source_event")
      .eq("organization_id", organizationId)
      .eq("source_type", sourceType)
      .in("source_id", ids.slice(i, i + 500));
    for (const row of data ?? []) keys.add(`${row.source_id}:${row.source_event}`);
  }
  return keys;
}

/** Order line items plus latest unit cost per SKU (product_costs via products.sku). */
async function loadUnitCostsBySku(supabase: SupabaseClient, organizationId: string, orderIds: string[]) {
  const lines = new Map<string, Array<{ sku: string | null; quantity: number }>>();
  const skus = new Set<string>();
  for (let i = 0; i < orderIds.length; i += 500) {
    const { data } = await supabase
      .from("order_line_items")
      .select("order_id, sku, quantity")
      .eq("organization_id", organizationId)
      .in("order_id", orderIds.slice(i, i + 500));
    for (const row of data ?? []) {
      const list = lines.get(row.order_id) ?? [];
      list.push({ sku: row.sku, quantity: Number(row.quantity ?? 1) });
      lines.set(row.order_id, list);
      if (row.sku) skus.add(String(row.sku).trim().toLowerCase());
    }
  }
  const costs = new Map<string, number>();
  if (!skus.size) return { lines, costs };
  const { data: products } = await supabase
    .from("products")
    .select("id, sku")
    .eq("organization_id", organizationId)
    .limit(10000);
  const skuByProduct = new Map<string, string>();
  for (const product of products ?? []) {
    const sku = String(product.sku ?? "").trim().toLowerCase();
    if (skus.has(sku)) skuByProduct.set(product.id, sku);
  }
  const productIds = [...skuByProduct.keys()];
  for (let i = 0; i < productIds.length; i += 500) {
    const { data } = await supabase
      .from("product_costs")
      .select("product_id, unit_cost, effective_from")
      .eq("organization_id", organizationId)
      .in("product_id", productIds.slice(i, i + 500))
      .order("effective_from", { ascending: true });
    // Ascending order: later rows overwrite earlier ones, leaving the latest cost.
    for (const row of data ?? []) {
      const sku = skuByProduct.get(row.product_id);
      if (sku) costs.set(sku, paiseFromNumeric(row.unit_cost));
    }
  }
  return { lines, costs };
}

export type SyncResult = { posted: number; skipped: number; failed: number; bySource: Record<string, number> };

/**
 * Backfills ledger entries for orders/shipments, reconciled COD remittances and
 * PostBus payments in a date range. Idempotent: each source posts at most once.
 */
export async function syncLedger(
  supabase: SupabaseClient,
  organizationId: string,
  period: { from: string; to: string }
): Promise<SyncResult> {
  await ensureChartOfAccounts(supabase, organizationId);
  const ctx = await loadBooksContext(supabase, organizationId);
  const from = ctx.booksStartDate && ctx.booksStartDate > period.from ? ctx.booksStartDate : period.from;
  const fromUtc = istDayStartUtc(from);
  const toUtc = istDayEndExclusiveUtc(period.to);
  const result: SyncResult = { posted: 0, skipped: 0, failed: 0, bySource: {} };
  const entries: PostingEntry[] = [];

  // Orders and India Post tariffs, recognised at booking.
  const { data: shipments } = await supabase
    .from("shipments")
    .select(
      "id, order_id, barcode, tracking_number, tariff_amount, cod_amount, payment_mode, status, booked_at, shipping_address_id"
    )
    .eq("organization_id", organizationId)
    .not("booked_at", "is", null)
    .gte("booked_at", fromUtc)
    .lt("booked_at", toUtc)
    .order("booked_at")
    .limit(SYNC_BATCH);
  const dispatched = (shipments ?? []).filter((row) => !NOT_DISPATCHED.has(String(row.status)));
  const orderIds = [...new Set(dispatched.map((row) => row.order_id as string))];
  const orders = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < orderIds.length; i += 500) {
    const { data } = await supabase
      .from("orders")
      .select("id, order_number, total_amount, shipping_amount, tax_amount, shipping_address_id, status")
      .eq("organization_id", organizationId)
      .in("id", orderIds.slice(i, i + 500));
    for (const row of data ?? []) orders.set(row.id, row);
  }
  const addressIds = [
    ...new Set(
      dispatched
        .map((row) => (row.shipping_address_id as string | null) ?? (orders.get(row.order_id)?.shipping_address_id as string | null))
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const states = new Map<string, string | null>();
  for (let i = 0; i < addressIds.length; i += 500) {
    const { data } = await supabase
      .from("addresses")
      .select("id, state")
      .eq("organization_id", organizationId)
      .in("id", addressIds.slice(i, i + 500));
    for (const row of data ?? []) states.set(row.id, stateCodeFromName(row.state));
  }

  const unitCostBySku = await loadUnitCostsBySku(supabase, organizationId, orderIds);
  const lineItemsByOrder = unitCostBySku.lines;

  const seenOrders = new Set<string>();
  for (const shipment of dispatched) {
    const date = istDate(shipment.booked_at as string);
    const tariffPaise = paiseFromNumeric(shipment.tariff_amount as string | null);
    if (tariffPaise > 0) {
      entries.push(
        shipmentChargeEntry({
          shipmentId: shipment.id,
          reference: String(shipment.barcode ?? shipment.tracking_number ?? shipment.id),
          entryDate: date,
          tariffPaise,
        })
      );
    }
    const order = orders.get(shipment.order_id);
    if (!order || seenOrders.has(shipment.order_id)) continue;
    seenOrders.add(shipment.order_id);
    const totalPaise = paiseFromNumeric(order.total_amount as string);
    if (totalPaise <= 0) continue;
    const shippingPaise = paiseFromNumeric(order.shipping_amount as string);
    const addressId = (shipment.shipping_address_id as string | null) ?? (order.shipping_address_id as string | null);
    const placeOfSupply = addressId ? states.get(addressId) ?? null : null;
    const sale = {
      orderId: shipment.order_id,
      orderNumber: String(order.order_number ?? shipment.order_id),
      entryDate: date,
      totalPaise,
      shippingPaise,
      codPaise: String(shipment.payment_mode).toUpperCase() === "COD" ? paiseFromNumeric(shipment.cod_amount as string) : 0,
      gst: orderGst(ctx, { totalPaise, shippingPaise, taxPaise: paiseFromNumeric(order.tax_amount as string) }, placeOfSupply),
    };
    try {
      entries.push(orderSaleEntry(sale));
      const returned = String(shipment.status) === "RTO";
      if (returned) entries.push(orderReturnEntry(sale));
      const cogsPaise = orderCogsPaise(lineItemsByOrder.get(shipment.order_id) ?? [], unitCostBySku.costs);
      if (cogsPaise && cogsPaise > 0) {
        const cogs = { orderId: sale.orderId, orderNumber: sale.orderNumber, entryDate: date, cogsPaise };
        entries.push(cogsEntry(cogs));
        if (returned) entries.push(cogsEntry({ ...cogs, returned: true }));
      }
    } catch (error) {
      result.failed += 1;
      logError("ai_accountant.sale_rule_failed", {
        organizationId,
        orderId: shipment.order_id,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  // Reconciled COD remittances.
  const { data: recon } = await supabase
    .from("cod_reconciliations")
    .select("report_row_id, status, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "RECONCILED")
    .gte("created_at", fromUtc)
    .lt("created_at", toUtc)
    .limit(SYNC_BATCH);
  const rowIds = (recon ?? []).map((row) => row.report_row_id as string);
  for (let i = 0; i < rowIds.length; i += 500) {
    const { data: rows } = await supabase
      .from("cod_report_rows")
      .select("id, article_barcode, delivered_on, cod_amount, commission_amount, net_amount")
      .eq("organization_id", organizationId)
      .in("id", rowIds.slice(i, i + 500));
    for (const row of rows ?? []) {
      const net = paiseFromNumeric(row.net_amount);
      const commission = paiseFromNumeric(row.commission_amount);
      if (net + commission <= 0) continue;
      const when = recon?.find((r) => r.report_row_id === row.id)?.created_at as string | undefined;
      entries.push(
        codRemittanceEntry({
          reportRowId: row.id,
          article: row.article_barcode,
          entryDate: row.delivered_on ?? istDate(when ?? new Date()),
          netPaise: net,
          commissionPaise: commission,
        })
      );
    }
  }

  // PostBus payments (subscription, add-ons, AI credits).
  const { data: payments } = await supabase
    .from("payments")
    .select("id, amount_paise, status, payment_purpose, paid_at, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "CAPTURED")
    .gte("created_at", fromUtc)
    .lt("created_at", toUtc)
    .limit(SYNC_BATCH);
  const paymentIds = (payments ?? []).map((row) => row.id as string);
  const invoices = new Map<string, GstSplit>();
  if (ctx.gstRegistered && paymentIds.length) {
    const { data } = await supabase
      .from("subscription_tax_invoices")
      .select("payment_id, cgst_paise, sgst_paise, igst_paise")
      .eq("organization_id", organizationId)
      .in("payment_id", paymentIds);
    for (const row of data ?? []) {
      invoices.set(row.payment_id, {
        cgstPaise: Number(row.cgst_paise ?? 0),
        sgstPaise: Number(row.sgst_paise ?? 0),
        igstPaise: Number(row.igst_paise ?? 0),
      });
    }
  }
  for (const payment of payments ?? []) {
    const amountPaise = Number(payment.amount_paise ?? 0);
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) continue;
    entries.push(
      platformPaymentEntry({
        paymentId: payment.id,
        entryDate: istDate((payment.paid_at ?? payment.created_at) as string),
        amountPaise,
        purpose: String(payment.payment_purpose ?? "subscription"),
        itc: invoices.get(payment.id),
      })
    );
  }

  // Skip sources already in the ledger, then post the rest.
  const byType = new Map<string, string[]>();
  for (const entry of entries) {
    const ids = byType.get(entry.sourceType) ?? [];
    ids.push(entry.sourceId);
    byType.set(entry.sourceType, ids);
  }
  const existing = new Set<string>();
  for (const [type, ids] of byType) {
    for (const key of await existingSourceKeys(supabase, organizationId, type, [...new Set(ids)])) {
      existing.add(`${type}:${key}`);
    }
  }
  for (const entry of entries) {
    if (existing.has(`${entry.sourceType}:${entry.sourceId}:${entry.sourceEvent}`)) {
      result.skipped += 1;
      continue;
    }
    try {
      await postEntry(supabase, organizationId, entry);
      result.posted += 1;
      result.bySource[entry.sourceType] = (result.bySource[entry.sourceType] ?? 0) + 1;
    } catch {
      result.failed += 1;
    }
  }

  await supabase
    .from("accounting_settings")
    .upsert({ organization_id: organizationId, last_synced_at: new Date().toISOString() }, { onConflict: "organization_id" });
  return result;
}

export const manualEntrySchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().trim().min(1).max(240),
  lines: z
    .array(
      z.object({
        accountCode: z.string().trim().min(1).max(20),
        debitPaise: z.number().int().min(0).default(0),
        creditPaise: z.number().int().min(0).default(0),
        memo: z.string().trim().max(240).optional(),
        party: z.string().trim().max(120).optional(),
      })
    )
    .min(2)
    .max(50),
});

/** Manual journal entry by account code (opening balances, adjustments). */
export async function postManualEntry(
  supabase: SupabaseClient,
  organizationId: string,
  raw: unknown,
  userId: string
) {
  const body = manualEntrySchema.parse(raw);
  await ensureChartOfAccounts(supabase, organizationId);
  const entry = assertBalanced({
    sourceType: "manual",
    sourceId: randomUUID(),
    sourceEvent: "manual",
    entryDate: body.entryDate,
    memo: body.memo,
    lines: body.lines.map((line) => ({
      accountKey: line.accountCode,
      debitPaise: line.debitPaise,
      creditPaise: line.creditPaise,
      memo: line.memo ?? null,
      party: line.party ?? null,
    })),
  });
  const { data, error } = await supabase.rpc("accounting_post_entry", {
    p_org: organizationId,
    p_entry: {
      memo: entry.memo,
      source_type: entry.sourceType,
      source_id: entry.sourceId,
      source_event: entry.sourceEvent,
      entry_date: entry.entryDate,
      created_by: userId,
    },
    p_lines: entry.lines.map((line) => ({
      account_code: line.accountKey,
      debit_paise: line.debitPaise,
      credit_paise: line.creditPaise,
      memo: line.memo,
      party: line.party,
    })),
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not post the journal entry. Check the account codes.");
  return { entryId: String(data) };
}

/** Posts a mirror entry. The original stays posted; reports net to zero. */
export async function reverseEntry(supabase: SupabaseClient, organizationId: string, entryId: string, userId: string) {
  const { data: entry } = await supabase
    .from("journal_entries")
    .select("id, memo, status, source_type")
    .eq("organization_id", organizationId)
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Journal entry not found.");
  if (entry.source_type === "reversal") throw new AppError(ERROR_CODES.CONFLICT, "A reversal cannot be reversed.");
  const { data: lines } = await supabase
    .from("journal_lines")
    .select("debit_paise, credit_paise, memo, party, gst_component, ledger_accounts(code)")
    .eq("organization_id", organizationId)
    .eq("entry_id", entryId);
  const { data, error } = await supabase.rpc("accounting_post_entry", {
    p_org: organizationId,
    p_entry: {
      memo: `Reversal: ${entry.memo ?? entryId}`,
      source_type: "reversal",
      source_id: entryId,
      source_event: "reverse",
      entry_date: istDate(),
      created_by: userId,
      reversal_of: entryId,
    },
    p_lines: (lines ?? []).map((line) => {
      const account = line.ledger_accounts as unknown as { code: string } | { code: string }[] | null;
      return {
        account_code: Array.isArray(account) ? account[0]?.code : account?.code,
        debit_paise: Number(line.credit_paise),
        credit_paise: Number(line.debit_paise),
        memo: line.memo,
        party: line.party,
        gst_component: line.gst_component,
      };
    }),
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not reverse the journal entry.");
  return { entryId: String(data) };
}

export async function listJournal(
  supabase: SupabaseClient,
  organizationId: string,
  input: { from: string; to: string; page?: number; pageSize?: number; sourceType?: string | null }
) {
  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 200);
  const page = Math.max(input.page ?? 1, 1);
  let query = supabase
    .from("journal_entries")
    .select(
      "id, entry_number, entry_date, memo, source_type, source_id, source_event, reversal_of, status, journal_lines(id, debit_paise, credit_paise, memo, party, gst_component, ledger_accounts(code, name, type))",
      { count: "exact" }
    )
    .eq("organization_id", organizationId)
    .gte("entry_date", input.from)
    .lte("entry_date", input.to)
    .order("entry_date", { ascending: false })
    .order("entry_number", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (input.sourceType) query = query.eq("source_type", input.sourceType);
  const { data, count, error } = await query;
  if (error) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not load the journal.");
  return { entries: data ?? [], total: count ?? 0, page, pageSize };
}

/** Reverses every not-yet-reversed entry for a source (used when an expense is edited or deleted). */
export async function reverseSourceEntries(
  supabase: SupabaseClient,
  organizationId: string,
  sourceType: string,
  sourceId: string,
  userId: string
) {
  const { data: entries } = await supabase
    .from("journal_entries")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("source_type", sourceType)
    .eq("source_id", sourceId);
  const ids = (entries ?? []).map((row) => row.id as string);
  if (!ids.length) return 0;
  const { data: reversed } = await supabase
    .from("journal_entries")
    .select("reversal_of")
    .eq("organization_id", organizationId)
    .in("reversal_of", ids);
  const done = new Set((reversed ?? []).map((row) => row.reversal_of as string));
  let count = 0;
  for (const id of ids) {
    if (done.has(id)) continue;
    await reverseEntry(supabase, organizationId, id, userId);
    count += 1;
  }
  return count;
}
