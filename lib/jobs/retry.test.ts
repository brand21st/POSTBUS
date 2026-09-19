import { describe, expect, it } from "vitest";
import { classifyProviderError } from "@/lib/jobs/retry";

describe("classifyProviderError", () => {
  it("retries timeouts and 429/5xx", () => {
    expect(classifyProviderError({ code: "ETIMEDOUT", message: "timeout" }).retryable).toBe(true);
    expect(classifyProviderError({ status: 429, message: "slow down" }).retryable).toBe(true);
    expect(classifyProviderError({ status: 503, message: "unavailable" }).retryable).toBe(true);
  });

  it("does not retry permanent validation errors", () => {
    expect(classifyProviderError({ code: "INVALID_PINCODE", message: "bad pin" }).retryable).toBe(false);
    expect(classifyProviderError({ code: "INVALID_BARCODE", message: "bad barcode" }).retryable).toBe(false);
    expect(classifyProviderError({ status: 400, message: "bad request" }).retryable).toBe(false);
  });
});
