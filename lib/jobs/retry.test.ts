import { describe, expect, it } from "vitest";
import { classifyProviderError, isDatabaseInfraError } from "@/lib/jobs/retry";

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
    for (const status of [500, 502, 503, 504]) {
      const afterPost = classifyProviderError({
        code: "CEPT_UNKNOWN",
        status,
        bookingPhase: "POST_SUBMIT",
        message: "after post",
      });
      expect(afterPost.retryable).toBe(false);
      expect(afterPost.code).toBe("CEPT_UNKNOWN");
    }
    expect(classifyProviderError({ status: 422, message: "unprocessable" }).retryable).toBe(false);
  });

  it("treats a read-only code TypeError as the original timeout", () => {
    const crashed = classifyProviderError({
      name: "TypeError",
      message: "Cannot set property code of #<DOMException> which has only a getter",
    });
    expect(crashed.retryable).toBe(true);
    expect(crashed.code).toBe("ETIMEDOUT");
    expect(crashed.message).not.toMatch(/only a getter/);

    const afterPost = classifyProviderError({
      message: "Cannot set property code of #<DOMException> which has only a getter",
      bookingPhase: "POST_SUBMIT",
      submitted: true,
    });
    expect(afterPost).toMatchObject({ retryable: false, code: "CEPT_UNKNOWN" });

    const beforePost = classifyProviderError({
      message: "Cannot set property code of #<DOMException> which has only a getter",
      bookingPhase: "PRE_POST",
      submitted: false,
    });
    expect(beforePost).toMatchObject({ retryable: true, code: "PRE_POST_TRANSIENT" });
  });

  it("retries Node fetch failures instead of treating them as validation", () => {
    const failed = classifyProviderError({ name: "TypeError", message: "fetch failed" });
    expect(failed.retryable).toBe(true);
    expect(failed.code).toBe("ECONNRESET");
    expect(failed.message).not.toMatch(/fetch failed/i);
  });
});

describe("isDatabaseInfraError", () => {
  it("recognises PostBus schema and connection failures", () => {
    expect(
      isDatabaseInfraError({
        code: "VALIDATION_ERROR",
        message: "Could not find the 'address_validation_fingerprint' column of 'addresses' in the schema cache",
      })
    ).toBe(true);
    expect(isDatabaseInfraError({ code: "PGRST205", message: "table not found" })).toBe(true);
    expect(isDatabaseInfraError({ code: "42703", message: "column addresses.foo does not exist" })).toBe(true);
  });

  it("leaves merchant data errors alone", () => {
    expect(isDatabaseInfraError({ code: "VALIDATION_ERROR", message: "Parcel weight is missing." })).toBe(false);
    expect(isDatabaseInfraError({ code: "INVALID_PINCODE", message: "PIN 441904 not found" })).toBe(false);
  });

  it("a tagged pre-submit database failure is retried", () => {
    const tagged = { code: "PRE_POST_TRANSIENT", bookingPhase: "PRE_POST", message: "Address check could not run." };
    expect(classifyProviderError(tagged)).toMatchObject({ retryable: true, code: "PRE_POST_TRANSIENT" });
  });
});
