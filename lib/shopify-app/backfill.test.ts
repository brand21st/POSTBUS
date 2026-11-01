import { describe, expect, it, vi } from "vitest";
import { startInstallBackfillOnce, type InstallBackfillDeps } from "@/lib/shopify-app/backfill";

const ctx = {
  installationId: "inst-1",
  organizationId: "org-1",
  installationStatus: "CONNECTED",
  shopDomain: "demo.myshopify.com",
};

function deps(overrides: Partial<InstallBackfillDeps> = {}): InstallBackfillDeps {
  return {
    claim: vi.fn(async () => true),
    release: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => ({ queued: true })),
    ...overrides,
  };
}

describe("startInstallBackfillOnce", () => {
  it("queues the import for the first open of a connected shop", async () => {
    const d = deps();
    await expect(startInstallBackfillOnce(ctx, d)).resolves.toEqual({ started: true });
    expect(d.claim).toHaveBeenCalledWith("inst-1", "org-1");
    expect(d.enqueue).toHaveBeenCalledWith("org-1");
  });

  it("does nothing once another open already claimed it", async () => {
    const d = deps({ claim: vi.fn(async () => false) });
    await expect(startInstallBackfillOnce(ctx, d)).resolves.toEqual({ started: false });
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it("waits until the shop token is connected", async () => {
    const d = deps();
    await startInstallBackfillOnce({ ...ctx, installationStatus: "REAUTH_REQUIRED" }, d);
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("releases the claim so the next open retries when queueing fails, without throwing", async () => {
    const d = deps({
      enqueue: vi.fn(async () => {
        throw new Error("queue down");
      }),
    });
    await expect(startInstallBackfillOnce(ctx, d)).resolves.toEqual({ started: false });
    expect(d.release).toHaveBeenCalledWith("inst-1", "org-1");
  });

  it("treats a not-queued result as a failure", async () => {
    const d = deps({ enqueue: vi.fn(async () => ({ queued: false })) });
    await expect(startInstallBackfillOnce(ctx, d)).resolves.toEqual({ started: false });
    expect(d.release).toHaveBeenCalled();
  });
});
