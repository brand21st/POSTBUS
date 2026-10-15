import { describe, expect, it, vi } from "vitest";
import { ensurePersistedIndiaPostSession, ensurePersistedIndiaPostTrackingSession } from "@/modules/india-post/session";

const ensureSession = vi.hoisted(() => vi.fn(async () => ({ tokens: null })));

vi.mock("@/modules/india-post/provider", () => ({
  indiaPostFromRow: () => ({ ensureSession }),
}));

describe("ensurePersistedIndiaPostSession", () => {
  it("does not login when the distributed booking lock is busy", async () => {
    ensureSession.mockClear();
    const rpc = vi.fn(async (name: string) => {
      if (name === "acquire_india_post_booking_lock") return { data: null, error: null };
      return { data: null, error: null };
    });
    await expect(
      ensurePersistedIndiaPostSession(
        { rpc } as never,
        { id: "conn-1", organization_id: "org-1" } as never
      )
    ).rejects.toMatchObject({ code: "TEMPORARY_PROVIDER_FAILURE" });
    expect(ensureSession).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalled();
  });

  it("lets tracking login without the India Post booking lock", async () => {
    ensureSession.mockClear();
    const rpc = vi.fn();
    const provider = await ensurePersistedIndiaPostTrackingSession(
      { rpc } as never,
      { id: "conn-1", organization_id: "org-1" } as never
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(ensureSession).toHaveBeenCalledTimes(1);
    expect(provider.ensureSession).toBe(ensureSession);
  });

  it("fails closed without login when organization id is missing", async () => {
    ensureSession.mockClear();
    const rpc = vi.fn();
    await expect(
      ensurePersistedIndiaPostSession({ rpc } as never, { id: "conn-1" } as never)
    ).rejects.toMatchObject({ code: "TEMPORARY_PROVIDER_FAILURE" });
    expect(rpc).not.toHaveBeenCalled();
    expect(ensureSession).not.toHaveBeenCalled();
  });
});
