import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { writeAccountingAudit } from "@/modules/ai-accountant/audit";
import { loadBooksContext } from "@/modules/ai-accountant/books-context";
import { EXPENSE_CATEGORIES, PAYMENT_ACCOUNTS, ensureChartOfAccounts } from "@/modules/ai-accountant/chart";
import { expenseEntry, inclusiveGst, ZERO_GST } from "@/modules/ai-accountant/ledger/posting-rules";
import { postEntry, reverseSourceEntries } from "@/modules/ai-accountant/ledger/post";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const stateCode = z.string().regex(/^\d{2}$/, "Use a two-digit GST state code.");

export const expenseSchema = z.object({
  incurredOn: isoDate,
  category: z.enum(EXPENSE_CATEGORIES),
  amountPaise: z.number().int().positive().max(10_000_000_000),
  rateBps: z.number().int().min(0).max(4000).default(0),
  itcClaimable: z.boolean().default(false),
  vendorName: z.string().trim().max(160).optional().nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
  paymentAccount: z.enum(PAYMENT_ACCOUNTS).default("bank"),
  placeOfSupply: stateCode.optional().nullable(),
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

const COLUMNS =
  "id, category, amount, amount_paise, tax_paise, rate_bps, vendor_name, memo, incurred_on, payment_account_key, receipt_path, created_at, updated_at";

export async function listExpenses(
  supabase: SupabaseClient,
  organizationId: string,
  input: { from: string; to: string; category?: string | null }
) {
  let query = supabase
    .from("expenses")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("incurred_on", input.from)
    .lte("incurred_on", input.to)
    .order("incurred_on", { ascending: false })
    .limit(500);
  if (input.category) query = query.eq("category", input.category);
  const { data, error } = await query;
  if (error) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not load expenses.");
  const rows = data ?? [];
  const byCategory: Record<string, number> = {};
  let totalPaise = 0;
  for (const row of rows) {
    const paise = Number(row.amount_paise ?? Math.round(Number(row.amount) * 100));
    totalPaise += paise;
    byCategory[row.category] = (byCategory[row.category] ?? 0) + paise;
  }
  return { expenses: rows, totalPaise, byCategory };
}

async function postExpense(
  supabase: SupabaseClient,
  organizationId: string,
  id: string,
  body: ExpenseInput,
  version: string
) {
  const ctx = await loadBooksContext(supabase, organizationId);
  const { gst } = inclusiveGst(body.amountPaise, body.rateBps, ctx.merchantState, body.placeOfSupply ?? ctx.merchantState);
  const itc = body.itcClaimable && ctx.gstRegistered ? gst : ZERO_GST;
  await ensureChartOfAccounts(supabase, organizationId);
  await postEntry(supabase, organizationId, {
    ...expenseEntry({
      expenseId: id,
      entryDate: body.incurredOn,
      categoryKey: body.category,
      totalPaise: body.amountPaise,
      itc,
      paymentAccountKey: body.paymentAccount,
      vendor: body.vendorName ?? null,
      memo: body.memo ?? null,
    }),
    sourceEvent: `expense:${version}`,
  });
  return itc.cgstPaise + itc.sgstPaise + itc.igstPaise;
}

function row(organizationId: string, body: ExpenseInput, taxPaise: number) {
  return {
    organization_id: organizationId,
    category: body.category,
    amount: body.amountPaise / 100,
    amount_paise: body.amountPaise,
    tax_paise: taxPaise,
    rate_bps: body.rateBps,
    vendor_name: body.vendorName ?? null,
    memo: body.memo ?? null,
    incurred_on: body.incurredOn,
    payment_account_key: body.paymentAccount,
    updated_at: new Date().toISOString(),
  };
}

export async function createExpense(supabase: SupabaseClient, organizationId: string, raw: unknown, userId: string) {
  const body = expenseSchema.parse(raw);
  const { data, error } = await supabase
    .from("expenses")
    .insert({ ...row(organizationId, body, 0), created_by: userId })
    .select("id, updated_at")
    .single();
  if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not save the expense.");
  let taxPaise: number;
  try {
    taxPaise = await postExpense(supabase, organizationId, data.id, body, String(Date.parse(data.updated_at)));
  } catch (error) {
    // Keep books and the expense list consistent: an unposted expense is withdrawn.
    await supabase.from("expenses").update({ deleted_at: new Date().toISOString() }).eq("id", data.id);
    throw error;
  }
  if (taxPaise) await supabase.from("expenses").update({ tax_paise: taxPaise }).eq("id", data.id);
  await writeAccountingAudit(supabase, {
    organizationId,
    actorId: userId,
    action: "expense.created",
    targetType: "expense",
    targetId: data.id,
    metadata: { amountPaise: body.amountPaise, category: body.category },
  });
  return { id: data.id };
}

async function loadExpense(supabase: SupabaseClient, organizationId: string, id: string) {
  const { data } = await supabase
    .from("expenses")
    .select("id, deleted_at")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (!data || data.deleted_at) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Expense not found.");
  return data;
}

/** Edits reverse the old ledger entry and post a fresh one. */
export async function updateExpense(
  supabase: SupabaseClient,
  organizationId: string,
  id: string,
  raw: unknown,
  userId: string
) {
  await loadExpense(supabase, organizationId, id);
  const body = expenseSchema.parse(raw);
  const updatedAt = new Date().toISOString();
  await reverseSourceEntries(supabase, organizationId, "expense", id, userId);
  const taxPaise = await postExpense(supabase, organizationId, id, body, String(Date.parse(updatedAt)));
  const { error } = await supabase
    .from("expenses")
    .update({ ...row(organizationId, body, taxPaise), updated_at: updatedAt })
    .eq("organization_id", organizationId)
    .eq("id", id);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not update the expense.");
  await writeAccountingAudit(supabase, { organizationId, actorId: userId, action: "expense.updated", targetType: "expense", targetId: id });
  return { id };
}

export async function deleteExpense(supabase: SupabaseClient, organizationId: string, id: string, userId: string) {
  await loadExpense(supabase, organizationId, id);
  await reverseSourceEntries(supabase, organizationId, "expense", id, userId);
  await supabase
    .from("expenses")
    .update({ deleted_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", id);
  await writeAccountingAudit(supabase, { organizationId, actorId: userId, action: "expense.deleted", targetType: "expense", targetId: id });
  return { id, deleted: true };
}
