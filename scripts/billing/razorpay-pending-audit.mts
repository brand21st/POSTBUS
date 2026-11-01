/**
 * READ-ONLY Razorpay correlation for stale PENDING subscription purchases.
 *
 * For each PENDING purchase older than 30 minutes, asks Razorpay which payments
 * exist on the order and prints a one-line classification. Never writes to the
 * database, never creates charges or refunds. Run by the owner before any
 * remediation, so no paying customer is downgraded:
 *
 *   npx tsx scripts/billing/razorpay-pending-audit.mts --env .env.local --read-only
 *
 * Output: purchase id prefix, order id, classification, amounts. No customer
 * names, emails, phone numbers, card data, or secrets are printed.
 */
import { readFileSync } from "node:fs";

function loadEnv(file: string) {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

const args = process.argv.slice(2);
if (!args.includes("--read-only")) {
  console.error("Refusing to run without --read-only (this script never writes, the flag confirms intent).");
  process.exit(1);
}
const envIndex = args.indexOf("--env");
if (envIndex >= 0) loadEnv(args[envIndex + 1]);

const { createAdminClient } = await import("@/lib/supabase/admin");
const { fetchRazorpayOrderPayments } = await import("@/modules/razorpay/client");

const supabase = createAdminClient();
const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
const { data, error } = await supabase
  .from("payments")
  .select("id, organization_id, razorpay_order_id, amount_paise, created_at")
  .eq("status", "PENDING")
  .eq("payment_purpose", "subscription")
  .not("razorpay_order_id", "is", null)
  .lte("created_at", cutoff)
  .order("created_at", { ascending: true })
  .limit(500);
if (error) {
  console.error("Could not read pending payments:", error.message);
  process.exit(1);
}

const totals: Record<string, number> = {};
for (const row of data ?? []) {
  let classification = "unpaid";
  let detail = "";
  try {
    const response = await fetchRazorpayOrderPayments(String(row.razorpay_order_id));
    const items = (response.items ?? []).filter((item) => item.order_id === row.razorpay_order_id);
    const captured = items.filter((item) => item.status === "captured");
    if (captured.length > 1) classification = "MULTIPLE_CAPTURED_REVIEW";
    else if (captured.length === 1) {
      classification = Number(captured[0].amount) === Number(row.amount_paise) ? "PAID_NOT_ACTIVATED" : "PAID_AMOUNT_MISMATCH";
    } else if (items.some((item) => item.status === "authorized")) classification = "authorized_only";
    else if (items.some((item) => item.status === "failed")) classification = "failed_attempts_only";
    detail = items.map((item) => `${item.status}:${item.amount}`).join(",");
  } catch (fetchError) {
    classification = "razorpay_error";
    detail = fetchError instanceof Error ? fetchError.message.slice(0, 80) : "unknown";
  }
  totals[classification] = (totals[classification] ?? 0) + 1;
  console.log(
    [String(row.id).slice(0, 8), row.razorpay_order_id, classification, row.amount_paise, String(row.created_at).slice(0, 16), detail].join(" | ")
  );
}
console.log("totals", JSON.stringify(totals));
