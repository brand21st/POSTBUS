import { describe, expect, it } from "vitest";
import { hashedCustomerOrderPublicId } from "@/modules/customer-order-links/public-id";

describe("hashedCustomerOrderPublicId", () => {
  it("returns a stable 4-digit code for an organization", () => {
    const first = hashedCustomerOrderPublicId("org-1");
    const second = hashedCustomerOrderPublicId("org-1");
    expect(first).toMatch(/^\d{4}$/);
    expect(second).toBe(first);
  });

  it("changes on collision retry", () => {
    expect(hashedCustomerOrderPublicId("org-1", 1)).not.toBe(hashedCustomerOrderPublicId("org-1", 0));
  });
});
