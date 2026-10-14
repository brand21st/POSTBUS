import { describe, expect, it } from "vitest";
import { ApiError, isConfirmedSessionLoss, isTransientApiAuthError } from "@/lib/hooks/use-api";

describe("api auth error helpers", () => {
  it("treats AUTH_REQUIRED 401 as confirmed session loss", () => {
    const error = new ApiError("Please sign in", 401, [{ code: "AUTH_REQUIRED" }]);
    expect(isConfirmedSessionLoss(error)).toBe(true);
    expect(isTransientApiAuthError(error)).toBe(false);
  });

  it("treats AUTH_UNAVAILABLE 503 as transient", () => {
    const error = new ApiError("try again", 503, [{ code: "AUTH_UNAVAILABLE" }]);
    expect(isConfirmedSessionLoss(error)).toBe(false);
    expect(isTransientApiAuthError(error)).toBe(true);
  });

  it("treats HTTP 429 as transient and not as logout", () => {
    const error = new ApiError("slow down", 429, [{ code: "RATE_LIMITED" }]);
    expect(isConfirmedSessionLoss(error)).toBe(false);
    expect(isTransientApiAuthError(error)).toBe(true);
  });

  it("treats HTTP 500 as recoverable for the session gate", () => {
    const error = new ApiError("boom", 500, [{ code: "INTERNAL_ERROR" }]);
    expect(isConfirmedSessionLoss(error)).toBe(false);
    expect(isTransientApiAuthError(error)).toBe(true);
  });
});
