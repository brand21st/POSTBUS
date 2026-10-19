import { describe, expect, it } from "vitest";
import { decryptSecret } from "@/lib/security/crypto";
import {
  accessTokenStillValid,
  indiaPostSessionPersistPatch,
  parseIndiaPostSessionTokens,
  refreshTokenStillValid,
} from "@/modules/india-post/session-tokens";

describe("India Post session token helpers", () => {
  it("parses the AUTH02 envelope used by production TokenWithRtoken", () => {
    const tokens = parseIndiaPostSessionTokens({
      success: true,
      data: {
        access_token: "access",
        refresh_token: "refresh",
        id_token: "id",
        expires_in: 1800,
        refresh_expires_in: 1800,
      },
    });
    expect(tokens).toMatchObject({ access_token: "access", expires_in: 1800, refresh_token: "refresh" });
  });

  it("rejects a malformed AUTH02 body", () => {
    expect(parseIndiaPostSessionTokens({ success: true, data: { expires_in: 1800 } })).toBeNull();
  });

  it("treats a missing refresh expiry as still usable", () => {
    expect(refreshTokenStillValid(null)).toBe(true);
    expect(refreshTokenStillValid("2000-01-01T00:00:00.000Z")).toBe(false);
    expect(accessTokenStillValid(new Date(Date.now() + 120_000).toISOString())).toBe(true);
    expect(accessTokenStillValid(new Date(Date.now() + 10_000).toISOString())).toBe(false);
  });

  it("does not null an omitted refresh token in the persist patch", () => {
    const patch = indiaPostSessionPersistPatch({ access_token: "plain-access", expires_in: 900 });
    expect(patch).not.toHaveProperty("encrypted_refresh_token");
    expect(decryptSecret(patch.encrypted_access_token)).toBe("plain-access");
  });
});
