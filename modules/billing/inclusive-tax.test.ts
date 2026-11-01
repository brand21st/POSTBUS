import { describe, expect, it } from "vitest";
import { amountForCycle } from "@/modules/billing/prices";
import { commissionPaise } from "@/modules/affiliates/policy";
import { allocateGst, billingTaxAutomationEnabled, gstInclusiveLabelEnabled, refundedTaxPaise, resolveApplicableSubscriptionTax, splitInclusiveTax, type TaxPolicyRecord } from "@/modules/billing/inclusive-tax";

const fixtureRate = 1800;
const approved = (overrides: Partial<TaxPolicyRecord> = {}): TaxPolicyRecord => ({
    id: "policy-1",
    version: 1,
    status: "APPROVED",
    pricesIncludeTax: true,
    treatment: "SINGLE_RATE_INCLUSIVE",
    rateBasisPoints: fixtureRate,
    placeOfSupply: "INTRA",
    effectiveAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
});

describe("GST-inclusive subscription tax", () => {
    it("keeps configured checkout amounts as the gross price", () => {
        expect(amountForCycle({ monthly_price_paise: 49900, yearly_price_paise: 479040 }, "monthly")).toBe(49900);
        expect(amountForCycle({ monthly_price_paise: 149900, yearly_price_paise: 1439040 }, "yearly")).toBe(1439040);
        expect(billingTaxAutomationEnabled()).toBe(false);
        expect(gstInclusiveLabelEnabled()).toBe(false);
    });

    it("extracts a test-only 18 percent inclusive split from 149900 paise", () => {
        const split = splitInclusiveTax(BigInt(149900), BigInt(fixtureRate));
        expect(split).toEqual({ taxablePaise: BigInt(127034), taxPaise: BigInt(22866) });
        expect(split.taxablePaise + split.taxPaise).toBe(BigInt(149900));
        const parts = allocateGst(split.taxPaise, "INTRA");
        expect(parts.cgstPaise + parts.sgstPaise + parts.igstPaise).toBe(split.taxPaise);
        expect(commissionPaise(split.taxablePaise, BigInt(2000))).toBe(BigInt(25407));
    });

    it("reconciles the configured catalog gross amounts under the same test rate", () => {
        for (const gross of [49900, 149900, 550000, 479040, 1439040, 5280000]) {
            const split = splitInclusiveTax(BigInt(gross), BigInt(fixtureRate));
            expect(split.taxablePaise + split.taxPaise).toBe(BigInt(gross));
        }
    });

    it("supports another approved rate without treating it as a default", () => {
        const split = splitInclusiveTax(BigInt(149900), BigInt(500));
        expect(split.taxablePaise + split.taxPaise).toBe(BigInt(149900));
        expect(split.taxPaise).not.toBe(BigInt(22866));
    });

    it("allocates IGST for an inter-state policy and keeps odd tax on SGST for intra-state", () => {
        expect(allocateGst(BigInt(101), "INTER")).toEqual({ cgstPaise: BigInt(0), sgstPaise: BigInt(0), igstPaise: BigInt(101) });
        expect(allocateGst(BigInt(101), "INTRA")).toEqual({ cgstPaise: BigInt(50), sgstPaise: BigInt(51), igstPaise: BigInt(0) });
    });

    it("blocks automatic evidence when no approved policy exists", () => {
        const result = resolveApplicableSubscriptionTax({ transactionAt: "2026-10-17T00:00:00.000Z", currency: "INR", grossPaise: BigInt(149900), policies: [{ ...approved(), status: "DRAFT" }] });
        expect(result.verdict).toBe("MISSING_CONFIGURATION");
        expect(result.breakdown).toBeNull();
    });

    it("uses the approved policy in force and leaves later policies off older payments", () => {
        const earlier = approved();
        const later = approved({ id: "policy-2", version: 2, rateBasisPoints: 500, effectiveAt: "2026-11-01T00:00:00.000Z" });
        const current = resolveApplicableSubscriptionTax({ transactionAt: "2026-10-17T00:00:00.000Z", currency: "INR", grossPaise: BigInt(149900), policies: [later, earlier] });
        expect(current.policy?.id).toBe("policy-1");
        expect(current.breakdown?.taxPaise).toBe(BigInt(22866));
        const future = resolveApplicableSubscriptionTax({ transactionAt: "2026-11-02T00:00:00.000Z", currency: "INR", grossPaise: BigInt(149900), policies: [earlier, later] });
        expect(future.policy?.id).toBe("policy-2");
    });

    it("rejects exclusive pricing, unsupported currency, and a one-paise amount that cannot split", () => {
        expect(resolveApplicableSubscriptionTax({ transactionAt: "2026-10-17T00:00:00.000Z", currency: "INR", grossPaise: BigInt(149900), policies: [approved({ pricesIncludeTax: false })] }).verdict).toBe("UNSUPPORTED_TAX_TREATMENT");
        expect(resolveApplicableSubscriptionTax({ transactionAt: "2026-10-17T00:00:00.000Z", currency: "USD", grossPaise: BigInt(149900), policies: [approved()] }).verdict).toBe("UNSUPPORTED_TAX_TREATMENT");
        expect(resolveApplicableSubscriptionTax({ transactionAt: "2026-10-17T00:00:00.000Z", currency: "INR", grossPaise: BigInt(1), policies: [approved()] }).verdict).toBe("REVIEW_REQUIRED");
    });

    it("accepts an explicit zero-rated policy and a proportional refund", () => {
        const zero = resolveApplicableSubscriptionTax({ transactionAt: "2026-10-17T00:00:00.000Z", currency: "INR", grossPaise: BigInt(49900), policies: [approved({ treatment: "ZERO_RATED", rateBasisPoints: 0, placeOfSupply: null })] });
        expect(zero.breakdown).toMatchObject({ taxablePaise: BigInt(49900), taxPaise: BigInt(0) });
        expect(refundedTaxPaise(BigInt(22866), BigInt(149900), BigInt(149900))).toBe(BigInt(22866));
        expect(refundedTaxPaise(BigInt(22866), BigInt(149900), BigInt(0))).toBe(BigInt(0));
    });
});
