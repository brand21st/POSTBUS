import { describe, expect, it } from "vitest";
import { classifyAuthSession, shouldRedirectToLogin } from "@/lib/auth/session/classify";

describe("classifyAuthSession", () => {
  it("treats a present user as valid", () => {
    expect(classifyAuthSession({ user: { id: "u1" }, error: null, hasAuthCookie: true })).toBe(
      "AUTH_VALID"
    );
  });

  it("treats no cookie and no user as a missing session", () => {
    expect(classifyAuthSession({ user: null, error: null, hasAuthCookie: false })).toBe(
      "AUTH_SESSION_MISSING"
    );
    expect(shouldRedirectToLogin("AUTH_SESSION_MISSING")).toBe(true);
  });

  it("treats refresh_token_not_found as invalid", () => {
    expect(
      classifyAuthSession({
        user: null,
        error: { code: "refresh_token_not_found", status: 400 },
        hasAuthCookie: true,
      })
    ).toBe("AUTH_SESSION_INVALID");
  });

  it("does not destroy the session on 429", () => {
    expect(
      classifyAuthSession({
        user: null,
        error: { code: "over_request_rate_limit", status: 429 },
        hasAuthCookie: true,
      })
    ).toBe("AUTH_RATE_LIMITED");
    expect(shouldRedirectToLogin("AUTH_RATE_LIMITED")).toBe(false);
  });

  it("treats concurrent refresh as recoverable", () => {
    expect(
      classifyAuthSession({
        user: null,
        error: { code: "refresh_token_already_used", status: 400 },
        hasAuthCookie: true,
      })
    ).toBe("AUTH_TRANSIENT_FAILURE");
    expect(shouldRedirectToLogin("AUTH_TRANSIENT_FAILURE")).toBe(false);
  });

  it("treats network/5xx as transient", () => {
    expect(
      classifyAuthSession({
        user: null,
        error: { name: "AuthRetryableFetchError", status: 503 },
        hasAuthCookie: true,
      })
    ).toBe("AUTH_TRANSIENT_FAILURE");
  });
});
