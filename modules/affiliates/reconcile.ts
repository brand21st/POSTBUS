import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchRazorpayPayment } from "@/modules/razorpay/client";
import { accrualEnabled, eligibleCapture } from "./policy";
import { billingTaxAutomationEnabled } from "@/modules/billing/inclusive-tax";
import { classifyTaxEvidence } from "./tax-evidence";
import { checked } from "./service";
import { AI_CREDITS_BILLING_CYCLE } from "@/modules/ai-credits/constants";
/** Existing scheduled job infrastructure calls this bounded, independently retryable worker.
 * The claim RPC serializes work across replicas; only captured provider evidence is stored.
 */
export async function runAffiliateSweep(db: SupabaseClient) {
    if (!accrualEnabled())
        return { enabled: false, processed: 0 };
    checked(await db.rpc("affiliate_prune_visits"));
    const jobs = checked(await db.rpc("affiliate_claim_payments", { p_limit: 20 })) as {
        payment_id: string;
        lease: string;
    }[];
    let processed = 0;
    for (const job of jobs) {
        let status = "RETRY";
        try {
            const p = checked(await db.from("payments").select("id,organization_id,subscription_id,razorpay_payment_id,razorpay_order_id,currency,billing_cycle,amount_paise").eq("id", job.payment_id).single());
            if (!p || !p.subscription_id || p.billing_cycle === AI_CREDITS_BILLING_CYCLE || !p.razorpay_payment_id || !p.razorpay_order_id) {
                status = "OWNERSHIP_REVIEW";
            }
            else {
                const subscription = checked(await db.from("subscriptions").select("id,organization_id").eq("id", p.subscription_id).eq("organization_id", p.organization_id).maybeSingle());
                const payment = await fetchRazorpayPayment(p.razorpay_payment_id);
                if (!subscription || !eligibleCapture(payment, { paymentId: p.razorpay_payment_id, orderId: p.razorpay_order_id, currency: p.currency }) || Number(payment.amount) !== Number(p.amount_paise)) {
                    status = "CAPTURE_REVIEW";
                }
                else {
                    // Capture must also appear in the signature-verified inbox. A browser callback cannot establish this time.
                    const evidence = checked(await db.rpc("affiliate_capture_time", { p_provider_payment: p.razorpay_payment_id })) as string | null;
                    if (!evidence)
                        status = "CAPTURE_REVIEW";
                    else {
                        checked(await db.from("affiliate_payment_evidence").upsert({ payment_id: p.id, provider_payment_id: p.razorpay_payment_id,
                            amount_paise: payment.amount, refunded_paise: payment.amount_refunded, captured_at: evidence, source: "razorpay-api-and-signed-inbox" }, { onConflict: "payment_id,refunded_paise", ignoreDuplicates: true }));
                        const applied = billingTaxAutomationEnabled()
                            ? checked(await db.rpc("subscription_apply_approved_tax", { p_payment: p.id })) as string
                            : "MISSING_CONFIGURATION";
                        if (applied !== "RECORDED" && applied !== "ALREADY_RECORDED" && applied !== "MISSING_CONFIGURATION") {
                            status = "TAX_REVIEW";
                        }
                        else {
                        const tax = checked(await db.from("affiliate_tax_evidence").select("tax_paise,refunded_tax_paise").eq("payment_id", p.id).eq("refunded_paise", Number(payment.amount_refunded)).maybeSingle()) as { tax_paise: number; refunded_tax_paise: number } | null;
                        const verdict = classifyTaxEvidence({
                            capturedPaise: BigInt(Number(payment.amount)),
                            refundedPaise: BigInt(Number(payment.amount_refunded)),
                            taxPaise: tax ? BigInt(tax.tax_paise) : null,
                            refundedTaxPaise: tax ? BigInt(tax.refunded_tax_paise) : null,
                            hasExisting: Boolean(tax),
                            hasAuthoritativeBreakdown: false,
                        });
                        status = verdict === "CONFLICT" || verdict === "INVALID"
                            ? "TAX_REVIEW"
                            : checked(await db.rpc("affiliate_accrue", { p_payment: p.id })) as string;
                        }
                    }
                }
            }
        }
        catch {
            status = "RETRY";
        }
        checked(await db.from("affiliate_processing").update({ status, updated_at: new Date().toISOString(),
            next_attempt_at: new Date(Date.now() + (status === "RETRY" ? 15 * 60000 : 24 * 3600000)).toISOString() }).eq("payment_id", job.payment_id).eq("lease", job.lease));
        processed++;
    }
    return { enabled: true, processed };
}
