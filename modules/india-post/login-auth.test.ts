import { describe, expect, it } from "vitest";
import { classifyProviderError } from "@/lib/jobs/retry";
import {
  createIndiaPostLoginError,
  createIndiaPostRefreshError,
  isConfirmedIndiaPostLoginAuthFailure,
  isConfirmedIndiaPostRefreshAuthFailure,
  isConfirmedTrackingAuthFailureJob,
  tagTrackingLoginAuthFailure,
} from "@/modules/india-post/login-auth";

describe("India Post login authentication classification", () => {
  it("treats login HTTP 400 with an authentication-failure phrase as confirmed auth failure", () => {
    const error = createIndiaPostLoginError(400, "Authentication failed");
    expect(error.code).toBe("HTTP_400");
    expect(error.indiaPostOperation).toBe("login");
    expect(isConfirmedIndiaPostLoginAuthFailure(error)).toBe(true);
    expect(classifyProviderError(error)).toMatchObject({ retryable: false, code: "HTTP_400" });
    expect(tagTrackingLoginAuthFailure(error)).toMatchObject({ code: "PERMANENT_AUTH_ERROR" });
  });

  it("does not treat login HTTP 400 validation copy as an auth hold", () => {
    const error = createIndiaPostLoginError(400, "customer id is required");
    expect(isConfirmedIndiaPostLoginAuthFailure(error)).toBe(false);
    expect(classifyProviderError(error)).toMatchObject({ retryable: false, code: "HTTP_400" });
    expect((tagTrackingLoginAuthFailure(error) as { code?: string }).code).toBe("HTTP_400");
  });

  it("treats login HTTP 401 as a permanent authentication failure", () => {
    const error = createIndiaPostLoginError(401, "Unauthorized");
    expect(error.code).toBe("PERMANENT_AUTH_ERROR");
    expect(isConfirmedIndiaPostLoginAuthFailure(error)).toBe(true);
    expect(classifyProviderError(error)).toMatchObject({ retryable: false, code: "PERMANENT_AUTH_ERROR" });
  });

  it("does not hold on HTTP 429, HTTP 500, or timeouts", () => {
    expect(
      isConfirmedIndiaPostLoginAuthFailure(Object.assign(new Error("slow down"), { status: 429, code: "HTTP_429" }))
    ).toBe(false);
    expect(
      isConfirmedIndiaPostLoginAuthFailure(
        Object.assign(new Error("unavailable"), { status: 500, code: "HTTP_500" })
      )
    ).toBe(false);
    expect(
      isConfirmedIndiaPostLoginAuthFailure(Object.assign(new Error("aborted"), { name: "AbortError" }))
    ).toBe(false);
    expect(classifyProviderError(Object.assign(new Error("slow down"), { status: 429 })).retryable).toBe(true);
    expect(classifyProviderError(Object.assign(new Error("unavailable"), { status: 500 })).retryable).toBe(true);
    expect(classifyProviderError(Object.assign(new Error("aborted"), { name: "AbortError" })).retryable).toBe(true);
  });

  it("does not classify bulk tracking HTTP 400 as a login authentication failure", () => {
    const error = Object.assign(new Error("article not found"), { status: 400, code: "HTTP_400" });
    expect(isConfirmedIndiaPostLoginAuthFailure(error)).toBe(false);
    expect(isConfirmedTrackingAuthFailureJob({ last_error_code: "HTTP_400", last_error: "article not found" })).toBe(
      false
    );
  });

  it("classifies durable tracking-sync job rows without treating missing connections as login auth", () => {
    expect(
      isConfirmedTrackingAuthFailureJob({
        last_error_code: "HTTP_400",
        last_error: "India Post authentication failed.",
      })
    ).toBe(true);
    expect(
      isConfirmedTrackingAuthFailureJob({
        last_error_code: "PERMANENT_AUTH_ERROR",
        last_error: "India Post is not connected.",
      })
    ).toBe(false);
    expect(
      isConfirmedTrackingAuthFailureJob({
        last_error_code: "HTTP_429",
        last_error: "rate limited",
      })
    ).toBe(false);
  });

  it("tags AUTH02 invalid refresh separately from tracking 403 entitlement", () => {
    const refresh = createIndiaPostRefreshError(400, "Invalid refresh token");
    expect(refresh.indiaPostOperation).toBe("refresh");
    expect(isConfirmedIndiaPostRefreshAuthFailure(refresh)).toBe(true);
    expect(isConfirmedIndiaPostLoginAuthFailure(refresh)).toBe(false);
    const tracking = Object.assign(new Error("You are not authorized to access this API"), {
      status: 403,
      code: "HTTP_403",
    });
    expect(isConfirmedIndiaPostRefreshAuthFailure(tracking)).toBe(false);
    expect(isConfirmedIndiaPostLoginAuthFailure(tracking)).toBe(false);
  });
});
