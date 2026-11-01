import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), limit: vi.fn(), rpc: vi.fn(), from: vi.fn(), pin: vi.fn() }));
vi.mock("@/lib/supabase/request-auth", () => ({ getRequestAuthUser: mocks.auth }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimit: mocks.limit }));
vi.mock("@/lib/admin/action-pin", () => ({ assertAdminActionPin: mocks.pin }));
import { handlePartnerApi, handleAffiliateAdmin } from "./api";
import { checked } from "./service";
const user = "10000000-0000-4000-8000-000000000001", partner = "20000000-0000-4000-8000-000000000001";
function req(path: string, method = "GET", body?: unknown) { return new NextRequest(`https://postbus.test/api/partner/${path}`, { method, headers: { origin: "https://postbus.test" }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
function chain(data: unknown) { const builder: Record<string, unknown> = {}; for (const method of ["select", "eq", "insert", "update", "order", "range", "is", "limit"])
    builder[method] = vi.fn(() => builder); builder.maybeSingle = vi.fn(async () => ({ data, error: null })); builder.single = builder.maybeSingle; builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve); return builder; }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("POSTBUS_AFFILIATES_ENABLED", "true"); vi.stubEnv("POSTBUS_AFFILIATE_PAYOUTS_ENABLED", "true"); vi.stubEnv("ADMIN_ACCOUNT_ACTION_PIN", "123456"); mocks.auth.mockResolvedValue({ user: { id: user } }); mocks.limit.mockReturnValue({ ok: true }); mocks.admin.mockReturnValue({ from: mocks.from, rpc: mocks.rpc }); mocks.from.mockReturnValue(chain({ id: partner, status: "APPROVED" })); mocks.rpc.mockResolvedValue({ data: [], error: null }); });
afterEach(() => vi.unstubAllEnvs());
describe("partner API security", () => {
    it("disabled routes do not load auth or service credentials", async () => { vi.stubEnv("POSTBUS_AFFILIATES_ENABLED", "false"); await expect(handlePartnerApi(req("me"), "me")).rejects.toMatchObject({ status: 404 }); expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled(); });
    it("requires authenticated identity", async () => { mocks.auth.mockResolvedValue({ user: null }); await expect(handlePartnerApi(req("me"), "me")).rejects.toMatchObject({ status: 401 }); expect(mocks.admin).not.toHaveBeenCalled(); });
    it("rejects cross-origin mutations", async () => { const r = new NextRequest("https://postbus.test/api/partner/payouts", { method: "POST", headers: { origin: "https://evil.test" } }); await expect(handlePartnerApi(r, "payouts")).rejects.toMatchObject({ status: 403 }); expect(mocks.admin).not.toHaveBeenCalled(); });
    it("throttles before database access", async () => { mocks.limit.mockReturnValue({ ok: false }); await expect(handlePartnerApi(req("me"), "me")).rejects.toMatchObject({ status: 429 }); expect(mocks.admin).not.toHaveBeenCalled(); });
    it("derives summary identity from authenticated profile, ignoring URL overrides", async () => { await handlePartnerApi(req("summary?affiliateId=another"), "summary"); expect(mocks.rpc).toHaveBeenCalledWith("affiliate_summary", expect.objectContaining({ p_affiliate: partner })); });
    it("rejects payout identity injection", async () => { await expect(handlePartnerApi(req("payouts", "POST", { affiliateId: "another", accountId: partner, amountPaise: 100000, key: user }), "payouts")).rejects.toThrow(); expect(mocks.rpc).not.toHaveBeenCalled(); });
    it("payout requests pass only session-owned affiliate identity", async () => { await handlePartnerApi(req("payouts", "POST", { accountId: partner, amountPaise: 100000, key: user }), "payouts"); expect(mocks.rpc).toHaveBeenCalledWith("affiliate_request_payout", { p_affiliate: partner, p_account: partner, p_amount: 100000, p_key: user }); });
    it("disabling payouts blocks new reservations", async () => { vi.stubEnv("POSTBUS_AFFILIATE_PAYOUTS_ENABLED", "false"); await expect(handlePartnerApi(req("payouts", "POST", {}), "payouts")).rejects.toMatchObject({ status: 403 }); expect(mocks.rpc).not.toHaveBeenCalled(); });
    it("suspended partners cannot create links", async () => { mocks.from.mockReturnValue(chain({ id: partner, status: "SUSPENDED" })); await expect(handlePartnerApi(req("links", "POST", { campaign: "new" }), "links")).rejects.toMatchObject({ status: 403 }); });
    it("refuses a second application for the same authenticated user", async () => { mocks.from.mockImplementation((table: string) => chain(table === "affiliate_settings" ? { registration_open: true } : { id: partner, status: "PENDING" })); await expect(handlePartnerApi(req("application", "POST", { fullName: "Asha Nair", mobile: "9876543210", business: "", website: "", social: "", channel: "Instagram", country: "IN", state: "Kerala", city: "Kochi", terms: true }), "application")).rejects.toMatchObject({ status: 409 }); expect(mocks.rpc).not.toHaveBeenCalled(); });
    it("issues a campaign link for the approved session partner", async () => { await handlePartnerApi(req("links", "POST", { campaign: "instagram" }), "links"); expect(mocks.from).toHaveBeenCalledWith("affiliate_links"); });
    it("rejects an unapproved landing page on campaign create", async () => {
        await expect(handlePartnerApi(req("campaigns", "POST", { campaign: "ads", landingPath: "https://evil.test" }), "campaigns")).rejects.toThrow();
        expect(mocks.from.mock.calls.map((call) => call[0])).not.toContain("affiliate_links");
    });
    it("aliases dashboard analytics to session-owned summary", async () => {
        mocks.from.mockImplementation((table: string) => chain(table === "affiliate_settings" ? { minimum_payout_paise: 100000, hold_days: 30, attribution_days: 30, registration_open: true } : table === "affiliate_policies" ? { basis_points: 2000 } : { id: partner, status: "APPROVED" }));
        await handlePartnerApi(req("dashboard?from=2026-01-01T00:00:00.000Z&to=2026-01-31T00:00:00.000Z"), "dashboard");
        expect(mocks.rpc).toHaveBeenCalledWith("affiliate_summary", expect.objectContaining({ p_affiliate: partner }));
    });
    it("passes referral filters to the partner-scoped report", async () => { await handlePartnerApi(req("referrals?page=1&q=Merchant&status=ACTIVE&from=2026-01-01T00:00:00.000Z&to=2026-01-31T00:00:00.000Z"), "referrals"); expect(mocks.rpc).toHaveBeenCalledWith("affiliate_partner_records", expect.objectContaining({ p_affiliate: partner, p_type: "referrals", p_offset: 25, p_query: "Merchant", p_status: "ACTIVE" })); });
    it("database errors never expose secrets", () => { expect(() => checked({ data: null, error: { message: "secret-provider-token" } })).toThrow("The affiliate operation could not be completed"); });
    it("admin mutations require configured action PIN", async () => { vi.stubEnv("ADMIN_ACCOUNT_ACTION_PIN", ""); await expect(handleAffiliateAdmin(req("actions", "POST", { pin: "123456", data: {} }), user, ["actions", partner])).rejects.toMatchObject({ status: 503 }); expect(mocks.rpc).not.toHaveBeenCalled(); });
    it("admin audited actions exclude PIN from stored payload", async () => { await handleAffiliateAdmin(req("actions", "POST", { pin: "123456", data: { action: "status", status: "APPROVED", reason: "Verified partner" } }), user, ["actions", partner]); expect(mocks.pin).toHaveBeenCalledWith("123456"); expect(mocks.rpc).toHaveBeenCalledWith("affiliate_admin_action", { p_actor: user, p_action: "status", p_id: partner, p_data: { action: "status", status: "APPROVED", reason: "Verified partner" } }); });
});
