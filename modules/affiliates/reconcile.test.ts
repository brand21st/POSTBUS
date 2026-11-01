import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/modules/razorpay/client", () => ({ fetchRazorpayPayment: mocks.fetch }));
import { runAffiliateSweep } from "./reconcile";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("POSTBUS_AFFILIATES_ENABLED", "true"); vi.stubEnv("POSTBUS_AFFILIATE_ACCRUAL_ENABLED", "true"); });
afterEach(() => vi.unstubAllEnvs());
function fixture(paymentPatch: Record<string, unknown> = {}) {
    const writes: Record<string, unknown>[] = [];
    const rpc = vi.fn(async (name: string) => ({ data: name === "affiliate_claim_payments" ? [{ payment_id: "p", lease: "lease-1" }] : name === "affiliate_capture_time" ? "2026-10-01T00:00:00Z" : name === "affiliate_accrue" ? "TAX_REVIEW" : null, error: null }));
    const from = vi.fn((table: string) => {
        const data = table === "payments" ? { id: "p", organization_id: "org", subscription_id: "s", razorpay_payment_id: "pay-1", razorpay_order_id: "order-1", currency: "INR", billing_cycle: "monthly", amount_paise: 10000, ...paymentPatch } : table === "subscriptions" ? { id: "s", organization_id: "org" } : null;
        const b: Record<string, unknown> = {};
        for (const k of ["select", "eq"])
            b[k] = vi.fn(() => b);
        for (const k of ["update", "upsert"])
            b[k] = vi.fn((value: Record<string, unknown>) => { writes.push({ table, ...value }); return b; });
        b.single = vi.fn(async () => ({ data, error: null }));
        b.maybeSingle = b.single;
        b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
        return b;
    });
    mocks.fetch.mockResolvedValue({ id: "pay-1", order_id: "order-1", status: "captured", captured: true, currency: "INR", amount: 10000, amount_refunded: 0 });
    return { db: { rpc, from } as unknown as SupabaseClient, rpc, from, writes };
}
it("does no external work when disabled", async () => { vi.stubEnv("POSTBUS_AFFILIATE_ACCRUAL_ENABLED", "false"); const f = fixture(); await runAffiliateSweep(f.db); expect(f.rpc).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled(); });
it("records captured evidence and uses the independent financial RPC", async () => { const f = fixture(); await runAffiliateSweep(f.db); expect(f.rpc).toHaveBeenCalledWith("affiliate_accrue", { p_payment: "p" }); expect(f.writes).toContainEqual(expect.objectContaining({ table: "affiliate_processing", status: "TAX_REVIEW" })); expect(f.from.mock.calls.every(([table]) => ["payments", "subscriptions", "affiliate_payment_evidence", "affiliate_tax_evidence", "affiliate_processing"].includes(table))).toBe(true); });
it("authorized payments never accrue", async () => { const f = fixture(); mocks.fetch.mockResolvedValue({ status: "authorized" }); await runAffiliateSweep(f.db); expect(f.rpc).not.toHaveBeenCalledWith("affiliate_accrue", expect.anything()); expect(f.writes).toContainEqual(expect.objectContaining({ status: "CAPTURE_REVIEW" })); });
it("AI credits never call the provider or accrue", async () => { const f = fixture({ billing_cycle: "ai_credits" }); await runAffiliateSweep(f.db); expect(mocks.fetch).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalledWith("affiliate_accrue", expect.anything()); });
it("provider failure records a safe retry category without its body", async () => { const f = fixture(); mocks.fetch.mockRejectedValue(new Error("secret payload")); await runAffiliateSweep(f.db); expect(f.writes).toContainEqual(expect.objectContaining({ status: "RETRY" })); expect(JSON.stringify(f.writes)).not.toContain("secret"); });
it("does not accrue when recorded tax conflicts with the captured amount", async () => {
    const f = fixture();
    f.from.mockImplementation((table: string) => {
        const data = table === "payments" ? { id: "p", organization_id: "org", subscription_id: "s", razorpay_payment_id: "pay-1", razorpay_order_id: "order-1", currency: "INR", billing_cycle: "monthly", amount_paise: 10000 } : table === "subscriptions" ? { id: "s", organization_id: "org" } : table === "affiliate_tax_evidence" ? { tax_paise: 10000, refunded_tax_paise: 0 } : null;
        const b: Record<string, unknown> = {};
        for (const k of ["select", "eq"]) b[k] = vi.fn(() => b);
        for (const k of ["update", "upsert"]) b[k] = vi.fn((value: Record<string, unknown>) => { f.writes.push({ table, ...value }); return b; });
        b.single = vi.fn(async () => ({ data, error: null }));
        b.maybeSingle = b.single;
        b.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
        return b;
    });
    await runAffiliateSweep(f.db);
    expect(f.rpc).not.toHaveBeenCalledWith("affiliate_accrue", expect.anything());
    expect(f.writes).toContainEqual(expect.objectContaining({ status: "TAX_REVIEW" }));
});
it("leaves accrual unchanged when tax automation is disabled", async () => {
    const f = fixture();
    await runAffiliateSweep(f.db);
    expect(f.rpc).not.toHaveBeenCalledWith("subscription_apply_approved_tax", expect.anything());
});
it("does not accrue when approved tax automation reports a conflict", async () => {
    vi.stubEnv("POSTBUS_BILLING_TAX_AUTOMATION_ENABLED", "true");
    const f = fixture();
    f.rpc.mockImplementation(async (name: string) => ({ data: name === "affiliate_claim_payments" ? [{ payment_id: "p", lease: "lease-1" }] : name === "affiliate_capture_time" ? "2026-10-01T00:00:00Z" : name === "subscription_apply_approved_tax" ? "CONFLICT" : "TAX_REVIEW", error: null }));
    await runAffiliateSweep(f.db);
    expect(f.rpc).toHaveBeenCalledWith("subscription_apply_approved_tax", { p_payment: "p" });
    expect(f.rpc).not.toHaveBeenCalledWith("affiliate_accrue", expect.anything());
    expect(f.writes).toContainEqual(expect.objectContaining({ status: "TAX_REVIEW" }));
});
