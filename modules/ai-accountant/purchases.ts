import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { writeAccountingAudit } from "@/modules/ai-accountant/audit";
import { loadBooksContext } from "@/modules/ai-accountant/books-context";
import { PAYMENT_ACCOUNTS, PURCHASE_CATEGORIES, ensureChartOfAccounts } from "@/modules/ai-accountant/chart";
import { gstinStateCode } from "@/modules/ai-accountant/gst";
import { purchaseEntry, splitTax, type GstSplit } from "@/modules/ai-accountant/ledger/posting-rules";
import { postEntry, reverseSourceEntries } from "@/modules/ai-accountant/ledger/post";
import { taxOnExclusive } from "@/modules/ai-accountant/money";

export const purchaseSchema = z.object({
  vendorName: z.string().trim().min(1).max(160),
  invoiceNumber: z.string().trim().max(60).optional().nullable(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z0-9]{13}$/, "GSTIN is invalid.")
    .optional()
    .nullable()
    .or(z.literal("")),
  taxablePaise: z.number().int().min(0).max(10_000_000_000),
  rateBps: z.number().int().min(0).max(4000).default(0),
  category: z.enum(PURCHASE_CATEGORIES).default("inventory"),
  itcEligible: z.boolean().default(true),
  paymentAccount: z.enum(PAYMENT_ACCOUNTS).default("accounts_payable"),
  placeOfSupply: z.string().regex(/^\d{2}$/).optional().nullable(),
});
export type PurchaseInput = z.infer<typeof purchaseSchema>;

/** Supplier GST: CGST+SGST when the supplier is in the merchant's state, else IGST. */
export function purchaseTax(body: PurchaseInput, merchantState: string | null): { gst: GstSplit; supplierState: string | null } {
  const taxPaise = taxOnExclusive(body.taxablePaise, body.rateBps);
  const supplierState = gstinStateCode(body.gstin || null) ?? body.placeOfSupply ?? null;
  return { gst: splitTax(taxPaise, merchantState, supplierState ?? merchantState), supplierState };
}

export async function listPurchases(supabase: SupabaseClient, organizationId: string, input: { from: string; to: string }) {
  const { data, error } = await supabase
    .from("purchase_invoices")
    .select(
      "id, vendor_name, invoice_number, invoice_date, gstin, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, rate_bps, category, itc_eligible, payment_account_key, receipt_path, created_at"
    )
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("invoice_date", input.from)
    .lte("invoice_date", input.to)
    .order("invoice_date", { ascending: false })
    .limit(500);
  if (error) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not load purchases.");
  const rows = data ?? [];
  const itcPaise = rows
    .filter((row) => row.itc_eligible)
    .reduce((sum, row) => sum + Number(row.cgst_paise) + Number(row.sgst_paise) + Number(row.igst_paise), 0);
  const totalPaise = rows.reduce((sum, row) => sum + Number(row.total_paise ?? 0), 0);
  return { purchases: rows, totalPaise, itcPaise };
}

async function persistAndPost(
  supabase: SupabaseClient,
  organizationId: string,
  body: PurchaseInput,
  existingId: string | null,
  userId: string
) {
  const ctx = await loadBooksContext(supabase, organizationId);
  const { gst, supplierState } = purchaseTax(body, ctx.merchantState);
  const itcEligible = body.itcEligible && ctx.gstRegistered && Boolean(body.gstin);
  const taxPaise = gst.cgstPaise + gst.sgstPaise + gst.igstPaise;
  const values = {
    organization_id: organizationId,
    vendor_name: body.vendorName,
    invoice_number: body.invoiceNumber ?? null,
    invoice_date: body.invoiceDate,
    gstin: body.gstin || null,
    taxable_amount: body.taxablePaise / 100,
    tax_amount: taxPaise / 100,
    total_amount: (body.taxablePaise + taxPaise) / 100,
    taxable_paise: body.taxablePaise,
    cgst_paise: gst.cgstPaise,
    sgst_paise: gst.sgstPaise,
    igst_paise: gst.igstPaise,
    total_paise: body.taxablePaise + taxPaise,
    rate_bps: body.rateBps,
    place_of_supply: supplierState,
    itc_eligible: itcEligible,
    category: body.category,
    payment_account_key: body.paymentAccount,
    updated_at: new Date().toISOString(),
  };
  let id = existingId;
  if (id) {
    const { error } = await supabase.from("purchase_invoices").update(values).eq("organization_id", organizationId).eq("id", id);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not update the purchase.");
  } else {
    const { data, error } = await supabase
      .from("purchase_invoices")
      .insert({ ...values, created_by: userId })
      .select("id")
      .single();
    if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not save the purchase.");
    id = data.id as string;
  }
  await ensureChartOfAccounts(supabase, organizationId);
  const entry = {
    ...purchaseEntry({
      purchaseId: id,
      entryDate: body.invoiceDate,
      categoryKey: body.category,
      taxablePaise: body.taxablePaise,
      gst,
      itcEligible,
      paymentAccountKey: body.paymentAccount,
      vendor: body.vendorName,
      invoiceNumber: body.invoiceNumber ?? null,
    }),
    sourceEvent: `purchase:${Date.parse(values.updated_at)}`,
  };
  try {
    await postEntry(supabase, organizationId, entry);
  } catch (error) {
    if (!existingId) await supabase.from("purchase_invoices").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    throw error;
  }
  return id;
}

export async function createPurchase(supabase: SupabaseClient, organizationId: string, raw: unknown, userId: string) {
  const body = purchaseSchema.parse(raw);
  const id = await persistAndPost(supabase, organizationId, body, null, userId);
  await writeAccountingAudit(supabase, {
    organizationId,
    actorId: userId,
    action: "purchase.created",
    targetType: "purchase_invoice",
    targetId: id,
    metadata: { taxablePaise: body.taxablePaise, vendor: body.vendorName },
  });
  return { id };
}

async function assertPurchase(supabase: SupabaseClient, organizationId: string, id: string) {
  const { data } = await supabase
    .from("purchase_invoices")
    .select("id, deleted_at")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (!data || data.deleted_at) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Purchase not found.");
}

export async function updatePurchase(
  supabase: SupabaseClient,
  organizationId: string,
  id: string,
  raw: unknown,
  userId: string
) {
  await assertPurchase(supabase, organizationId, id);
  const body = purchaseSchema.parse(raw);
  await reverseSourceEntries(supabase, organizationId, "purchase_invoice", id, userId);
  await persistAndPost(supabase, organizationId, body, id, userId);
  await writeAccountingAudit(supabase, { organizationId, actorId: userId, action: "purchase.updated", targetType: "purchase_invoice", targetId: id });
  return { id };
}

export async function deletePurchase(supabase: SupabaseClient, organizationId: string, id: string, userId: string) {
  await assertPurchase(supabase, organizationId, id);
  await reverseSourceEntries(supabase, organizationId, "purchase_invoice", id, userId);
  await supabase
    .from("purchase_invoices")
    .update({ deleted_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", id);
  await writeAccountingAudit(supabase, { organizationId, actorId: userId, action: "purchase.deleted", targetType: "purchase_invoice", targetId: id });
  return { id, deleted: true };
}
