import type { SupabaseClient } from "@supabase/supabase-js";

export type PurchaseRow = {
  id: string;
  organization_id: string;
  subscription_id: string | null;
  plan_id: string;
  amount_paise: number;
  currency: string;
  status: string;
  billing_cycle: "monthly" | "yearly" | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  payment_purpose?: string | null;
};

export function isCapturedRazorpayStatus(status: string | null | undefined) {
  return String(status ?? "").toLowerCase() === "captured";
}

export function rpcFunctionMissing(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message ?? "");
  return error?.code === "42883" || error?.code === "PGRST202" || /does not exist|could not find the function/i.test(message);
}

export async function loadPurchasesByOrder(
  supabase: SupabaseClient,
  razorpayOrderId: string
): Promise<PurchaseRow[]> {
  const { data } = await supabase
    .from("payments")
    .select(
      "id, organization_id, subscription_id, plan_id, amount_paise, currency, status, billing_cycle, razorpay_order_id, razorpay_payment_id, payment_purpose"
    )
    .eq("razorpay_order_id", razorpayOrderId);
  return ((data ?? []) as PurchaseRow[]).filter(
    (row) => !row.payment_purpose || row.payment_purpose === "subscription"
  );
}

export async function resolvePurchaseByOrder(
  supabase: SupabaseClient,
  razorpayOrderId: string
): Promise<{ purchase: PurchaseRow } | { missing: true } | { ambiguous: true; count: number }> {
  const rows = await loadPurchasesByOrder(supabase, razorpayOrderId);
  if (rows.length === 0) return { missing: true };
  if (rows.length > 1) return { ambiguous: true, count: rows.length };
  return { purchase: rows[0] };
}

/** @deprecated Use resolvePurchaseByOrder — single-row lookup is unsafe when order IDs collide. */
export async function loadPurchaseByOrder(
  supabase: SupabaseClient,
  razorpayOrderId: string
): Promise<PurchaseRow | null> {
  const resolved = await resolvePurchaseByOrder(supabase, razorpayOrderId);
  if ("purchase" in resolved) return resolved.purchase;
  return null;
}

export function purchaseAmountMatches(purchase: PurchaseRow, amountPaise: number) {
  return Number(amountPaise) === Number(purchase.amount_paise);
}

export function purchaseCurrencyMatches(purchase: PurchaseRow, currency?: string | null) {
  return (purchase.currency || "INR").toUpperCase() === (currency || "INR").toUpperCase();
}
