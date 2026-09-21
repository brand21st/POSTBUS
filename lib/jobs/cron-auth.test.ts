import { describe, expect, it } from "vitest";
import { authorizeCron, readCronSecret } from "@/lib/jobs/cron-auth";

function headers(init: Record<string, string>) {
  return new Headers(init);
}

describe("readCronSecret", () => {
  it("reads a bearer token", () => {
    expect(readCronSecret(headers({ authorization: "Bearer abc123" }))).toBe("abc123");
  });

  it("reads the x-cron-secret header", () => {
    expect(readCronSecret(headers({ "x-cron-secret": "abc123" }))).toBe("abc123");
  });

  it("returns empty when absent", () => {
    expect(readCronSecret(headers({}))).toBe("");
  });
});

describe("authorizeCron", () => {
  it("rejects when no secret is configured", () => {
    const result = authorizeCron(headers({ authorization: "Bearer abc123" }), "");
    expect(result).toEqual({
      authorized: false,
      reason: "CRON_SECRET is not set, so the job runner endpoint is disabled.",
    });
  });

  it("rejects a missing secret", () => {
    expect(authorizeCron(headers({}), "abc123")).toEqual({
      authorized: false,
      reason: "Missing cron secret.",
    });
  });

  it("rejects a wrong secret of the same length", () => {
    expect(authorizeCron(headers({ authorization: "Bearer abc124" }), "abc123")).toEqual({
      authorized: false,
      reason: "Invalid cron secret.",
    });
  });

  it("rejects a wrong secret of a different length", () => {
    expect(authorizeCron(headers({ authorization: "Bearer abc" }), "abc123")).toEqual({
      authorized: false,
      reason: "Invalid cron secret.",
    });
  });

  it("accepts the configured secret", () => {
    expect(authorizeCron(headers({ authorization: "Bearer abc123" }), "abc123")).toEqual({
      authorized: true,
    });
  });
});
