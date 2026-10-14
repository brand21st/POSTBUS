import { describe, expect, it } from "vitest";
import { ApiError, isConfirmedSessionLoss, isTransientApiAuthError } from "@/lib/hooks/use-api";

describe("api auth error helpers", () => {
  it("treats AUTH_REQUIRED 401 as confirmed session loss", () => {
    const error = new ApiError("Please sign in", 401, [{ code: "AUTH_REQUIRED" }]);
    expect(isConfirmedSessionLoss(error)).toBe(true);
    expect(isTransientApiAuthError(error)).toBe(false);
  });

  it("does not treat 500 as logout", () => {
    const error = new ApiError("boom", 500, [{ code: "INTERNAL_ERROR" }]);
    expect(isConfirmedSessionLoss(error)).toBe(false);
    expect(isTransientApiAuthError(error)).toBe(false);
  });

  it("treats AUTH_UNAVAILABLE 503 as transient", () => {
    const error = new ApiError("try again", 503, [{ code: "AUTH_UNAVAILABLE" }]);
    expect(isConfirmedSessionLoss(error)).toBe(false);
    expect(isTransientApiAuthError(error)).toBe(true);
  });
});
