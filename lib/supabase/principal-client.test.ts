import { beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_CODES } from "@/lib/api/errors";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import {
  principalAccessToken,
  resetPrincipalTokenCacheForTests,
  type PrincipalSession,
  type PrincipalSessionDeps,
  type PrincipalSessionRow,
} from "@/lib/supabase/principal-client";

const NOW = Date.parse("2026-10-23T10:00:00Z");
const session = (accessToken: string, minutes: number): PrincipalSession => ({
  accessToken,
  refreshToken: `r-${accessToken}`,
  expiresAt: new Date(NOW + minutes * 60_000).toISOString(),
});
const sealed = (value: PrincipalSession) => encryptSecret(JSON.stringify(value));

function row(overrides: Partial<PrincipalSessionRow> = {}): PrincipalSessionRow {
  return {
    id: "inst-1",
    principal_user_id: "user-1",
    encrypted_principal_secret: encryptSecret(JSON.stringify({ email: "p@principals.postbus.in", password: "pw" })),
    encrypted_principal_session: null,
    principal_session_expires_at: null,
    principal_session_version: 2,
    ...overrides,
  };
}

function deps(overrides: Partial<PrincipalSessionDeps> = {}): PrincipalSessionDeps {
  return {
    claimLease: vi.fn(async () => true),
    save: vi.fn(async () => undefined),
    reload: vi.fn(async () => null),
    refresh: vi.fn(async () => session("refreshed", 60)),
    signIn: vi.fn(async () => session("signed-in", 60)),
    sleep: vi.fn(async () => undefined),
    now: () => NOW,
    ...overrides,
  };
}

describe("principalAccessToken", () => {
  beforeEach(() => resetPrincipalTokenCacheForTests());

  it("signs in the first time and stores the session encrypted with a version bump", async () => {
    const d = deps();
    expect(await principalAccessToken(row(), d)).toBe("signed-in");
    expect(d.signIn).toHaveBeenCalledWith("p@principals.postbus.in", "pw");
    const [, version, values] = vi.mocked(d.save).mock.calls[0];
    expect(version).toBe(2);
    expect(values.principal_session_version).toBe(3);
    const stored = JSON.parse(decryptSecret(values.encrypted_principal_session as string)) as PrincipalSession;
    expect(stored.accessToken).toBe("signed-in");
  });

  it("uses a stored session that is still valid without calling Supabase Auth", async () => {
    const d = deps();
    expect(await principalAccessToken(row({ encrypted_principal_session: sealed(session("stored", 30)) }), d)).toBe(
      "stored"
    );
    expect(d.claimLease).not.toHaveBeenCalled();
  });

  it("refreshes a stale session, falling back to sign-in if the refresh token is dead", async () => {
    const d = deps({ refresh: vi.fn(async () => null) });
    expect(await principalAccessToken(row({ encrypted_principal_session: sealed(session("old", 0)) }), d)).toBe(
      "signed-in"
    );
    expect(d.refresh).toHaveBeenCalledWith("r-old");
  });

  it("waits for the lease holder and adopts its session", async () => {
    const published = row({ principal_session_version: 3, encrypted_principal_session: sealed(session("from-peer", 60)) });
    const d = deps({ claimLease: vi.fn(async () => false), reload: vi.fn(async () => published) });
    expect(await principalAccessToken(row({ encrypted_principal_session: sealed(session("old", 0)) }), d)).toBe(
      "from-peer"
    );
    expect(d.signIn).not.toHaveBeenCalled();
    expect(d.refresh).not.toHaveBeenCalled();
  });

  it("releases the lease and fails when Supabase Auth is down", async () => {
    const d = deps({
      signIn: vi.fn(async () => {
        throw new Error("down");
      }),
    });
    await expect(principalAccessToken(row(), d)).rejects.toThrow("down");
    expect(d.save).toHaveBeenCalledWith("inst-1", 2, { principal_session_lease_until: null });
  });

  it("refuses an installation without a principal", async () => {
    await expect(principalAccessToken(row({ principal_user_id: null }), deps())).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_UNAVAILABLE,
    });
  });
});
