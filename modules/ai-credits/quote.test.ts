import { describe, expect, it } from "vitest";
import { DEFAULT_AI_CREDIT_PACKAGES } from "@/modules/ai-credits/constants";
import { quoteAiCredits } from "@/modules/ai-credits/quote";

const packages = DEFAULT_AI_CREDIT_PACKAGES.map((item, index) => ({
  id: `pkg-${index}`,
  credits: item.credits,
  pricePaise: item.pricePaise,
  isActive: true,
}));

describe("quoteAiCredits", () => {
  it("prices the published packages", () => {
    expect(quoteAiCredits(500, packages).amountPaise).toBe(9900);
    expect(quoteAiCredits(1000, packages).amountPaise).toBe(17900);
    expect(quoteAiCredits(2500, packages).amountPaise).toBe(39900);
    expect(quoteAiCredits(5000, packages).amountPaise).toBe(69900);
    expect(quoteAiCredits(10000, packages).amountPaise).toBe(119900);
    expect(quoteAiCredits(5000, packages).perCreditRupees).toBeCloseTo(0.1398, 4);
  });

  it("interpolates custom amounts between packages", () => {
    const quote = quoteAiCredits(7500, packages);
    expect(quote.packageId).toBeNull();
    expect(quote.amountPaise).toBe(94900);
  });

  it("uses a package id instead of a client price", () => {
    const quote = quoteAiCredits(1, packages, undefined, "pkg-2");
    expect(quote.credits).toBe(2500);
    expect(quote.amountPaise).toBe(39900);
  });

  it("rejects invalid custom amounts", () => {
    expect(() => quoteAiCredits(-1, packages)).toThrow();
    expect(() => quoteAiCredits(0, packages)).toThrow();
    expect(() => quoteAiCredits(12.5, packages)).toThrow();
    expect(() => quoteAiCredits(100, packages)).toThrow();
    expect(() => quoteAiCredits(20000, packages)).toThrow();
  });
});
