import { describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import {
  ensurePersistedIndiaPostSession,
  ensurePersistedIndiaPostTrackingSession,
  persistIndiaPostTokens,
} from "@/modules/india-post/session";

const ensureSession = vi.hoisted(() => vi.fn(async () => ({ tokens: null })));

vi.mock("@/modules/india-post/provider", () => ({
  indiaPostFromRow: () => ({ ensureSession }),
}));

function sessionLockRpc(data: string | null = "session-lock-token") {
  return vi.fn(async (name: string) => {
    if (name === "acquire_india_post_session_lock") return { data, error: null };
    if (name === "release_india_post_session_lock") return { data: null, error: null };
    if (name === "acquire_india_post_booking_lock") throw new Error("booking lock must not be used for session persist");
    return { data: null, error: null };
  });
}

describe("ensurePersistedIndiaPostSession", () => {
  it("does not login when the distributed session lock is busy", async () => {
    ensureSession.mockClear();
    const rpc = sessionLockRpc(null);
    await expect(
      ensurePersistedIndiaPostSession(
        { rpc } as never,
        { id: "conn-1", organization_id: "org-1" } as never,
        { waitMs: 80 }
      )
    ).rejects.toMatchObject({ code: "TEMPORARY_PROVIDER_FAILURE" });
    expect(ensureSession).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalled();
    expect(rpc.mock.calls.some(([name]) => name === "acquire_india_post_booking_lock")).toBe(false);
  });

  it("uses the session lock for tracking and never takes the booking lock", async () => {
    ensureSession.mockClear();
    const rpc = sessionLockRpc();
    const provider = await ensurePersistedIndiaPostTrackingSession(
      { rpc } as never,
      { id: "conn-1", organization_id: "org-1" } as never
    );
    expect(rpc.mock.calls.map(([name]) => name)).toContain("acquire_india_post_session_lock");
    expect(rpc.mock.calls.map(([name]) => name)).toContain("release_india_post_session_lock");
    expect(rpc.mock.calls.some(([name]) => name === "acquire_india_post_booking_lock")).toBe(false);
    expect(ensureSession).toHaveBeenCalledTimes(1);
    expect(provider.ensureSession).toBe(ensureSession);
  });

  it("fails closed without login when the session lock RPC is missing", async () => {
    ensureSession.mockClear();
    const rpc = vi.fn(async () => ({ data: null, error: { code: "42883", message: "function acquire_india_post_session_lock does not exist" } }));
    await expect(
      ensurePersistedIndiaPostSession({ rpc } as never, { id: "conn-1", organization_id: "org-1" } as never)
    ).rejects.toMatchObject({ code: "TEMPORARY_PROVIDER_FAILURE" });
    expect(ensureSession).not.toHaveBeenCalled();
  });

  it("fails closed without login when organization id is missing", async () => {
    ensureSession.mockClear();
    const rpc = sessionLockRpc();
    await expect(
      ensurePersistedIndiaPostSession({ rpc } as never, { id: "conn-1" } as never)
    ).rejects.toMatchObject({ code: "TEMPORARY_PROVIDER_FAILURE" });
    expect(rpc).not.toHaveBeenCalled();
    expect(ensureSession).not.toHaveBeenCalled();
  });
});

describe("persistIndiaPostTokens", () => {
  it("keeps the existing refresh token when AUTH02 omits rotation", async () => {
    let patch: Record<string, unknown> = {};
    const supabase = {
      from: () => ({
        update: (value: Record<string, unknown>) => {
          patch = value;
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: { id: "conn-1" }, error: null }),
                }),
              }),
            }),
          };
        },
      }),
    };
    await persistIndiaPostTokens(
      supabase as never,
      { id: "conn-1", organization_id: "org-1" },
      { access_token: "new-access", expires_in: 900 }
    );
    expect(patch.encrypted_access_token).toBeTruthy();
    expect(patch).not.toHaveProperty("encrypted_refresh_token");
    expect(JSON.stringify(patch)).not.toContain("new-access");
  });

  it("stores a rotated refresh token without leaking plaintext", async () => {
    let patch: Record<string, unknown> = {};
    const supabase = {
      from: () => ({
        update: (value: Record<string, unknown>) => {
          patch = value;
          return {
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: { id: "conn-1" }, error: null }),
              }),
            }),
          };
        },
      }),
    };
    await persistIndiaPostTokens(supabase as never, { id: "conn-1" }, {
      access_token: "eyJrotated.access",
      refresh_token: "eyJrotated.refresh",
      expires_in: 1800,
      refresh_expires_in: 1800,
    });
    expect(decryptSecret(String(patch.encrypted_refresh_token))).toBe("eyJrotated.refresh");
    expect(JSON.stringify(patch)).not.toContain("eyJrotated");
  });

  it("refuses to persist when the session lock fencing token no longer matches", async () => {
    const supabase = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    };
    await expect(
      persistIndiaPostTokens(
        supabase as never,
        { id: "conn-1", organization_id: "org-1", sessionLockToken: "stale-fence" },
        { access_token: "stolen-write", expires_in: 900 }
      )
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("does not put plaintext tokens in persist errors", async () => {
    const supabase = {
      from: () => ({
        update: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: null, error: { message: "secret database details eyJabc" } }),
            }),
          }),
        }),
      }),
    };
    await expect(
      persistIndiaPostTokens(supabase as never, { id: "conn-1" }, { access_token: "eyJsecret", expires_in: 900 })
    ).rejects.toThrow("Unable to save the India Post session. Please retry.");
    await expect(
      persistIndiaPostTokens(supabase as never, { id: "conn-1" }, { access_token: "eyJsecret", expires_in: 900 })
    ).rejects.not.toThrow(/eyJsecret|secret database details/);
  });
});
