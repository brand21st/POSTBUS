import { afterEach, describe, it, expect, vi } from "vitest";
import { commissionPaise, reversalPaise, eligibleCapture, affiliateEnabled, accrualEnabled, payoutsEnabled, isPublicReferralCode, formatPaiseInr, formatBasisPoints, publicReferralPath, campaignLinkSchema } from "./policy";
import { classifyTaxEvidence, assertAffiliateStagingTarget } from "./tax-evidence";
import { readReferral, signReferral } from "./cookie";
afterEach(() => vi.unstubAllEnvs());
describe("affiliate financial policy", () => {
    it("rounds integer paise half-up and supports fixed caps", () => { expect(commissionPaise(BigInt(149900), BigInt(2000))).toBe(BigInt(29980)); expect(commissionPaise(BigInt(3), BigInt(5000))).toBe(BigInt(2)); expect(commissionPaise(BigInt(10), BigInt(2000), BigInt(20))).toBe(BigInt(10)); });
    it("cumulative refunds reach exactly the original amount", () => { expect(reversalPaise(BigInt(7), BigInt(33), BigInt(33))).toBe(BigInt(7)); expect(() => reversalPaise(BigInt(7), BigInt(33), BigInt(34))).toThrow(); });
    const expected = { paymentId: "p1", orderId: "o1", currency: "INR" };
    const payment = { id: "p1", order_id: "o1", currency: "INR", status: "captured", captured: true, amount: 10000, amount_refunded: 0 };
    it("accepts captured and fully refunded captured payments", () => { expect(eligibleCapture(payment, expected)).toBe(true); expect(eligibleCapture({ ...payment, status: "refunded", amount_refunded: 10000 }, expected)).toBe(true); });
    it.each([{ status: "authorized" }, { status: "failed" }, { captured: false }, { currency: "USD" }, { order_id: "other" }, { amount: NaN }, { amount: -1 }, { amount_refunded: 10001 }])("rejects invalid evidence %j", patch => expect(eligibleCapture({ ...payment, ...patch }, expected)).toBe(false));
    it("all write switches default off", () => { vi.stubEnv("POSTBUS_AFFILIATES_ENABLED", ""); vi.stubEnv("POSTBUS_AFFILIATE_ACCRUAL_ENABLED", "true"); vi.stubEnv("POSTBUS_AFFILIATE_PAYOUTS_ENABLED", "true"); expect(affiliateEnabled()).toBe(false); expect(accrualEnabled()).toBe(false); expect(payoutsEnabled()).toBe(false); });
    it("signed attribution expires and rejects tampering", () => { vi.stubEnv("POSTBUS_AFFILIATE_COOKIE_SECRET", "s".repeat(32)); const value = { link: "10000000-0000-4000-8000-000000000001", visitor: "a".repeat(32), expires: 2000 }; const cookie = signReferral(value); expect(readReferral(cookie, 1000)).toEqual(value); expect(readReferral(cookie, 2000)).toBeNull(); expect(readReferral(cookie + "x", 1000)).toBeNull(); expect(readReferral("untrusted", 1000)).toBeNull(); });
    it("rejects short and internal referral identifiers", () => { expect(isPublicReferralCode("PB12345")).toBe(false); expect(isPublicReferralCode("10000000-0000-4000-8000-000000000001")).toBe(false); expect(isPublicReferralCode("a".repeat(24))).toBe(true); });
    it("formats paise in INR and basis points from stored integers", () => { expect(formatPaiseInr(149900)).toBe("₹1,499.00"); expect(formatPaiseInr(0)).toBe("₹0.00"); expect(formatBasisPoints(2000)).toBe("20%"); expect(formatBasisPoints(2050)).toBe("20.50%"); });
    it("builds opaque referral URLs only for PostBus landing pages", () => {
        expect(publicReferralPath("abcdefghijklmnopqrstuvwx", "/pricing", { utmCampaign: "instagram" })).toBe("/pricing?ref=abcdefghijklmnopqrstuvwx&utm_campaign=instagram");
        expect(campaignLinkSchema.parse({ campaign: "instagram", landingPath: "/" }).landingPath).toBe("/");
        expect(() => campaignLinkSchema.parse({ campaign: "x", landingPath: "/login" })).toThrow();
    });
    it("does not treat a captured total as tax evidence", () => {
        expect(classifyTaxEvidence({ capturedPaise: BigInt(2000000), hasExisting: false, hasAuthoritativeBreakdown: false })).toBe("MISSING");
        expect(classifyTaxEvidence({ capturedPaise: BigInt(2000000), hasExisting: true, taxPaise: BigInt(0), hasAuthoritativeBreakdown: false })).toBe("VERIFIED");
        expect(classifyTaxEvidence({ capturedPaise: BigInt(2000000), hasExisting: true, taxPaise: BigInt(2000000), hasAuthoritativeBreakdown: false })).toBe("CONFLICT");
        expect(classifyTaxEvidence({ capturedPaise: BigInt(0), hasExisting: false, hasAuthoritativeBreakdown: false })).toBe("INVALID");
        expect(assertAffiliateStagingTarget({ projectRef: "prod", productionRefs: ["prod"], approvedStagingRef: "stage" }).ok).toBe(false);
        expect(assertAffiliateStagingTarget({ projectRef: "stage", productionRefs: ["prod"], approvedStagingRef: "stage" }).reason).toBe("remote_write_not_authorized");
        expect(assertAffiliateStagingTarget({
            projectRef: "stage",
            productionRefs: ["prod"],
            approvedStagingRef: "stage",
            writeAuthorized: "AFFILIATE_STAGING_WRITE_APPROVED",
            environmentName: "staging",
            supabaseUrl: "https://stage.supabase.co",
        }).ok).toBe(true);
        expect(assertAffiliateStagingTarget({
            projectRef: "stage",
            productionRefs: ["prod"],
            approvedStagingRef: "stage",
            writeAuthorized: "AFFILIATE_STAGING_WRITE_APPROVED",
            supabaseUrl: "https://hgacoeoovjxkzfbesmvl.supabase.co",
        }).reason).toBe("production_hostname");
        expect(assertAffiliateStagingTarget({ projectRef: "", productionRefs: [], approvedStagingRef: "stage" }).ok).toBe(false);
    });
});
