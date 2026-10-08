import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/api/context";
import { handleCommerceRoutes } from "@/lib/api/v1/commerce";
import { handleBillingRoutes } from "@/lib/api/v1/billing";

const quoteMerchantAiCredits = vi.hoisted(() => vi.fn());
const startAiCreditsCheckout = vi.hoisted(() => vi.fn());
const getAiCreditsSnapshot = vi.hoisted(() => vi.fn());
const listAiCreditLedger = vi.hoisted(() => vi.fn());

vi.mock("@/modules/ai-credits/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/ai-credits/service")>();
  return {
    ...actual,
    quoteMerchantAiCredits,
    startAiCreditsCheckout,
    getAiCreditsSnapshot,
    listAiCreditLedger,
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  hasAdminClient: () => true,
  createAdminClient: () => ({ from: () => ({}) }),
}));

const ctx: TenantContext = {
  userId: "user-1",
  email: "merchant@example.com",
  fullName: "Merchant",
  organizationId: "org-1",
  organizationName: "Shop",
  role: "OWNER",
  permissions: ["org.billing", "orders.read"],
};

describe("AI credits API", () => {
  it("quotes package prices from the server catalog", async () => {
    quoteMerchantAiCredits.mockResolvedValue({
      credits: 500,
      amountPaise: 9900,
      perCreditRupees: 0.198,
      packageId: "pkg-starter",
    });
    const result = await handleCommerceRoutes(
      new NextRequest("http://localhost:3000/api/v1/ai-credits/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credits: 500 }),
      }),
      {} as never,
      ctx,
      "POST ai-credits/quote",
      "POST",
      ["ai-credits", "quote"]
    );
    expect(quoteMerchantAiCredits).toHaveBeenCalledWith({ packageId: undefined, credits: 500 });
    expect(result).toMatchObject({ credits: 500, amountPaise: 9900 });
  });

  it("starts checkout with package id and ignores a client price", async () => {
    startAiCreditsCheckout.mockResolvedValue({
      razorpayOrderId: "order_test",
      amountPaise: 39900,
      packSize: 2500,
    });
    const result = await handleBillingRoutes(
      new NextRequest("http://localhost:3000/api/v1/billing/ai-credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: "pkg-pro", amountPaise: 1 }),
      }),
      {} as never,
      ctx,
      "POST billing/ai-credits/checkout"
    );
    expect(startAiCreditsCheckout).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        packageId: "pkg-pro",
        credits: undefined,
      })
    );
    expect(result).toMatchObject({ razorpayOrderId: "order_test", amountPaise: 39900 });
  });

  it("does not leak another workspace ledger", async () => {
    listAiCreditLedger.mockImplementation(async (_supabase: unknown, organizationId: string) =>
      organizationId === "org-1" ? [{ id: "a" }] : []
    );
    const mine = (await handleCommerceRoutes(
      new NextRequest("http://localhost:3000/api/v1/ai-credits/ledger"),
      {} as never,
      ctx,
      "GET ai-credits/ledger",
      "GET",
      ["ai-credits", "ledger"]
    )) as { entries: unknown[] };
    const other = (await handleCommerceRoutes(
      new NextRequest("http://localhost:3000/api/v1/ai-credits/ledger"),
      {} as never,
      { ...ctx, organizationId: "org-2" },
      "GET ai-credits/ledger",
      "GET",
      ["ai-credits", "ledger"]
    )) as { entries: unknown[] };
    expect(mine.entries).toHaveLength(1);
    expect(other.entries).toHaveLength(0);
  });
});
