import { describe, expect, it } from "vitest";
import { supportMerchantIdFromPayload } from "@/modules/support/ingest";

describe("supportMerchantIdFromPayload", () => {
  it("reads merchant_id from the Vachat envelope data", () => {
    expect(supportMerchantIdFromPayload({ data: { merchant_id: "org-1" } })).toBe("org-1");
    expect(supportMerchantIdFromPayload({ merchant_id: "org-2" })).toBe("org-2");
    expect(supportMerchantIdFromPayload({ data: {} })).toBe("");
  });
});
