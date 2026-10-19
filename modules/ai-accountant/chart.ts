import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export type SystemAccount = { key: string; code: string; name: string; type: AccountType };

/** Default chart of accounts for an Indian D2C merchant shipping through India Post. */
export const DEFAULT_CHART: readonly SystemAccount[] = [
  { key: "cash", code: "1000", name: "Cash in hand", type: "ASSET" },
  { key: "bank", code: "1010", name: "Bank", type: "ASSET" },
  { key: "cod_receivable", code: "1100", name: "India Post COD receivable", type: "ASSET" },
  { key: "accounts_receivable", code: "1110", name: "Prepaid gateway receivable", type: "ASSET" },
  { key: "inventory", code: "1200", name: "Inventory", type: "ASSET" },
  { key: "gst_input_cgst", code: "1300", name: "GST input CGST", type: "ASSET" },
  { key: "gst_input_sgst", code: "1301", name: "GST input SGST", type: "ASSET" },
  { key: "gst_input_igst", code: "1302", name: "GST input IGST", type: "ASSET" },
  { key: "accounts_payable", code: "2000", name: "Accounts payable", type: "LIABILITY" },
  { key: "india_post_payable", code: "2010", name: "India Post payable", type: "LIABILITY" },
  { key: "gst_output_cgst", code: "2100", name: "GST output CGST", type: "LIABILITY" },
  { key: "gst_output_sgst", code: "2101", name: "GST output SGST", type: "LIABILITY" },
  { key: "gst_output_igst", code: "2102", name: "GST output IGST", type: "LIABILITY" },
  { key: "owner_equity", code: "3000", name: "Owner's capital", type: "EQUITY" },
  { key: "retained_earnings", code: "3100", name: "Retained earnings", type: "EQUITY" },
  { key: "sales", code: "4000", name: "Sales", type: "REVENUE" },
  { key: "shipping_income", code: "4010", name: "Shipping charged to customers", type: "REVENUE" },
  { key: "sales_returns", code: "4030", name: "Sales returns (RTO)", type: "REVENUE" },
  { key: "other_income", code: "4900", name: "Other income", type: "REVENUE" },
  { key: "cogs", code: "5000", name: "Cost of goods sold", type: "EXPENSE" },
  { key: "shipping_expense", code: "5100", name: "India Post shipping", type: "EXPENSE" },
  { key: "cod_commission", code: "5110", name: "India Post COD commission", type: "EXPENSE" },
  { key: "platform_fees", code: "5200", name: "PostBus subscription and add-ons", type: "EXPENSE" },
  { key: "ai_credits", code: "5210", name: "PostBus AI credits", type: "EXPENSE" },
  { key: "packaging", code: "5300", name: "Packaging", type: "EXPENSE" },
  { key: "marketing", code: "5310", name: "Marketing and ads", type: "EXPENSE" },
  { key: "rent", code: "5320", name: "Rent", type: "EXPENSE" },
  { key: "salaries", code: "5330", name: "Salaries and wages", type: "EXPENSE" },
  { key: "utilities", code: "5340", name: "Utilities and internet", type: "EXPENSE" },
  { key: "software", code: "5350", name: "Software and subscriptions", type: "EXPENSE" },
  { key: "professional_fees", code: "5360", name: "Professional fees", type: "EXPENSE" },
  { key: "bank_charges", code: "5370", name: "Bank and gateway charges", type: "EXPENSE" },
  { key: "travel", code: "5380", name: "Travel and conveyance", type: "EXPENSE" },
  { key: "other_expense", code: "5390", name: "Other expenses", type: "EXPENSE" },
];

export const EXPENSE_CATEGORIES = [
  "packaging",
  "marketing",
  "rent",
  "salaries",
  "utilities",
  "software",
  "professional_fees",
  "bank_charges",
  "travel",
  "shipping_expense",
  "other_expense",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const PURCHASE_CATEGORIES = ["inventory", ...EXPENSE_CATEGORIES] as const;
export type PurchaseCategory = (typeof PURCHASE_CATEGORIES)[number];

export const PAYMENT_ACCOUNTS = ["bank", "cash", "accounts_payable", "owner_equity"] as const;
export type PaymentAccount = (typeof PAYMENT_ACCOUNTS)[number];

export function systemAccount(key: string) {
  return DEFAULT_CHART.find((account) => account.key === key) ?? null;
}

/** Debit-normal accounts grow with debits; credit-normal with credits. */
export function isDebitNormal(type: string) {
  return type === "ASSET" || type === "EXPENSE";
}

/** Idempotently inserts any missing system accounts for an organization. */
export async function ensureChartOfAccounts(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase
    .from("ledger_accounts")
    .select("system_key, code")
    .eq("organization_id", organizationId);
  if (error) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not load the chart of accounts.");
  const keys = new Set((data ?? []).map((row) => row.system_key).filter(Boolean));
  const codes = new Set((data ?? []).map((row) => row.code));
  const missing = DEFAULT_CHART.filter((account) => !keys.has(account.key) && !codes.has(account.code));
  if (!missing.length) return { created: 0 };
  const { error: insertError } = await supabase.from("ledger_accounts").upsert(
    missing.map((account) => ({
      organization_id: organizationId,
      code: account.code,
      name: account.name,
      type: account.type,
      system_key: account.key,
      is_system: true,
    })),
    { onConflict: "organization_id,code", ignoreDuplicates: true }
  );
  if (insertError) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not create the chart of accounts.");
  return { created: missing.length };
}

export async function listAccounts(supabase: SupabaseClient, organizationId: string) {
  await ensureChartOfAccounts(supabase, organizationId);
  const { data } = await supabase
    .from("ledger_accounts")
    .select("id, code, name, type, system_key, is_system")
    .eq("organization_id", organizationId)
    .order("code");
  return data ?? [];
}
