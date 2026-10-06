import { describe, expect, it } from "vitest";
import { CUSTOMER_ORDER_LINK_TOKEN } from "@/modules/customer-order-links/schema";
import { createCustomerOrderLinkToken } from "@/modules/customer-order-links/token";

describe("createCustomerOrderLinkToken", () => {
  it("returns a 16-character grouped code", () => {
    const token = createCustomerOrderLinkToken();
    expect(token).toMatch(/^[2-9a-hjkmnp-z]{4}(?:-[2-9a-hjkmnp-z]{4}){3}$/);
    expect(CUSTOMER_ORDER_LINK_TOKEN.test(token)).toBe(true);
    expect(token).not.toMatch(/[01ilo]/);
  });
});
