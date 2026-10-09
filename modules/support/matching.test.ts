import { describe, expect, it } from "vitest";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";

describe("support order matching phones", () => {
  it("normalizes WhatsApp and Shopify-style numbers to the same 10 digits", () => {
    expect(extractIndiaMobileDigits("+91 98765 43210")).toBe("9876543210");
    expect(extractIndiaMobileDigits("919876543210")).toBe("9876543210");
    expect(extractIndiaMobileDigits("09876543210")).toBe("9876543210");
  });
});
