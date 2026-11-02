import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authorizeCron = vi.fn();
const runBillingSweep = vi.fn();
const runAddonBillingSweep = vi.fn();
const hasAdminClient = vi.fn();

vi.mock("@/lib/jobs/cron-auth", () => ({
  authorizeCron: (...args: unknown[]) => authorizeCron(...args),
}));

vi.mock("@/modules/billing/cron", () => ({
  runBillingSweep: (...args: unknown[]) => runBillingSweep(...args),
}));

vi.mock("@/modules/addons/cron", () => ({
  runAddonBillingSweep: (...args: unknown[]) => runAddonBillingSweep(...args),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasAdminClient: () => hasAdminClient(),
  createAdminClient: () => ({ mocked: true }),
}));

import { POST } from "@/app/api/cron/billing/route";

describe("POST /api/cron/billing", () => {
  beforeEach(() => {
    authorizeCron.mockReset();
    runBillingSweep.mockReset();
    runAddonBillingSweep.mockReset();
    hasAdminClient.mockReset();
    hasAdminClient.mockReturnValue(true);
    runAddonBillingSweep.mockResolvedValue({ expired: 0 });
  });

  it("rejects missing or invalid cron authentication", async () => {
    authorizeCron.mockReturnValue({ authorized: false, reason: "Invalid cron secret." });
    const response = await POST(new NextRequest("http://127.0.0.1:3000/api/cron/billing", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(runBillingSweep).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ success: false });
  });

  it("returns 500 when the sweep throws", async () => {
    authorizeCron.mockReturnValue({ authorized: true });
    runBillingSweep.mockRejectedValue(new Error("relation subscriptions does not exist"));
    const response = await POST(new NextRequest("http://127.0.0.1:3000/api/cron/billing", { method: "POST" }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ success: false });
  });

  it("returns sweep counts on success", async () => {
    authorizeCron.mockReturnValue({ authorized: true });
    runBillingSweep.mockResolvedValue({
      expired: 1,
      skipped: 0,
      failures: 0,
      eligible: 1,
      expiringNotices: 0,
      reconciled: 0,
      durationMs: 4,
      status: "ok",
    });
    const response = await POST(new NextRequest("http://127.0.0.1:3000/api/cron/billing", { method: "POST" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { expired: 1, status: "ok", addons: { expired: 0 } },
    });
  });
});
