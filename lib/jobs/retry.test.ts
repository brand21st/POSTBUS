import { describe, expect, it } from "vitest";
import { classifyProviderError } from "@/lib/jobs/retry";

describe("classifyProviderError", () => {
  it("retries timeouts and 429/5xx", () => {
    expect(classifyProviderError({ code: "ETIMEDOUT", message: "timeout" }).retryable).toBe(true);
    expect(classifyProviderError({ name: "AbortError", message: "The operation was aborted" }).retryable).toBe(true);
    expect(classifyProviderError({ status: 429, message: "slow down" }).retryable).toBe(true);
    expect(classifyProviderError({ status: 503, message: "unavailable" }).retryable).toBe(true);
  });

  it("does not retry permanent validation errors", () => {
    expect(classifyProviderError({ code: "INVALID_PINCODE", message: "bad pin" }).retryable).toBe(false);
    expect(classifyProviderError({ code: "INVALID_BARCODE", message: "bad barcode" }).retryable).toBe(false);
    expect(classifyProviderError({ code: "VALIDATION_ERROR", message: "weight missing" }).retryable).toBe(false);
    expect(classifyProviderError({ code: "INVALID_WEIGHT", message: "too heavy" }).retryable).toBe(false);
    expect(classifyProviderError({ status: 400, message: "bad request" }).retryable).toBe(false);
    expect(classifyProviderError({ status: 401, message: "unauthorized" }).retryable).toBe(false);
  });

  it("retries CEPT HTTP 409 processing conflicts only", () => {
    const conflict = classifyProviderError({
      status: 409,
      message: "Internal server error during processing",
    });
    expect(conflict.retryable).toBe(true);
    expect(conflict.code).toBe("TEMPORARY_PROVIDER_FAILURE");
    expect(conflict.httpStatus).toBe(409);

    const other409 = classifyProviderError({
      status: 409,
      message: "Shipment already exists",
    });
    expect(other409.retryable).toBe(false);
    expect(other409.code).toBe("CEPT_UNKNOWN");

    const duplicate409 = classifyProviderError({
      status: 409,
      message: "Duplicate article: Already booked today or yesterday",
    });
    expect(duplicate409.retryable).toBe(false);
    expect(duplicate409.code).toBe("CEPT_DUPLICATE");
  });

  it("retries 429 and 5xx but not generic 4xx", () => {
    expect(classifyProviderError({ status: 429, message: "rate" }).retryable).toBe(true);
    expect(classifyProviderError({ status: 500, message: "boom" }).retryable).toBe(true);
    expect(classifyProviderError({ status: 422, message: "unprocessable" }).retryable).toBe(false);
  });
});
