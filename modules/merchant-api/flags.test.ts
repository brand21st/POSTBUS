import { afterEach, describe, expect, it } from "vitest";
import { isMerchantApiOpenForOrg, isMerchantApiProcessEnabled, merchantApiOrgAllowlist } from "@/modules/merchant-api/flags";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  delete process.env.MERCHANT_API_ENABLED;
  delete process.env.MERCHANT_API_ORG_ALLOWLIST;
});

describe("merchant API rollout flags", () => {
  it("disables every org when the allowlist is empty", () => {
    process.env.MERCHANT_API_ENABLED = "true";
    process.env.MERCHANT_API_ORG_ALLOWLIST = "";
    expect(isMerchantApiProcessEnabled()).toBe(true);
    expect(merchantApiOrgAllowlist()).toEqual([]);
    expect(isMerchantApiOpenForOrg(ORG_A)).toBe(false);
  });

  it("allows only listed organizations", () => {
    process.env.MERCHANT_API_ORG_ALLOWLIST = `${ORG_A}, ${ORG_B}`;
    expect(isMerchantApiOpenForOrg(ORG_A)).toBe(true);
    expect(isMerchantApiOpenForOrg(ORG_B.toUpperCase())).toBe(true);
    expect(isMerchantApiOpenForOrg("33333333-3333-4333-8333-333333333333")).toBe(false);
  });

  it("kills the API even for allowlisted orgs", () => {
    process.env.MERCHANT_API_ENABLED = "false";
    process.env.MERCHANT_API_ORG_ALLOWLIST = ORG_A;
    expect(isMerchantApiOpenForOrg(ORG_A)).toBe(false);
  });
});
