import { describe, expect, it } from "vitest";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import {
  assertIndiaPostWebhookSourceAllowed,
  ipMatchesCidrs,
  isIndiaPostWebhookQuarantined,
  parseCidrList,
  webhookSourceIp,
} from "@/modules/india-post/webhook-allowlist";

describe("India Post webhook allowlist", () => {
  it("parses comma and space separated CIDRs", () => {
    expect(parseCidrList(" 1.2.3.4/32, 10.0.0.0/8  192.168.1.1 ")).toEqual([
      "1.2.3.4/32",
      "10.0.0.0/8",
      "192.168.1.1",
    ]);
  });

  it("matches an address inside a prefix", () => {
    expect(ipMatchesCidrs("10.9.8.7", ["10.0.0.0/8"])).toBe(true);
    expect(ipMatchesCidrs("11.0.0.1", ["10.0.0.0/8"])).toBe(false);
    expect(ipMatchesCidrs("1.2.3.4", ["1.2.3.4"])).toBe(true);
  });

  it("quarantines ingestion when the allowlist is empty", () => {
    expect(isIndiaPostWebhookQuarantined("")).toBe(true);
    expect(isIndiaPostWebhookQuarantined("  ")).toBe(true);
    expect(isIndiaPostWebhookQuarantined("10.0.0.0/8")).toBe(false);
    expect(() => assertIndiaPostWebhookSourceAllowed("8.8.8.8", "")).not.toThrow();
  });

  it("rejects a missing or unmatched IP when an allowlist is configured", () => {
    expect(() => assertIndiaPostWebhookSourceAllowed(null, "10.0.0.0/8")).toThrow(AppError);
    try {
      assertIndiaPostWebhookSourceAllowed("8.8.8.8", "10.0.0.0/8");
    } catch (error) {
      expect(error).toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    }
  });

  it("prefers cf-connecting-ip over x-forwarded-for", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "10.0.0.1, 10.0.0.2",
    });
    expect(webhookSourceIp(headers)).toBe("203.0.113.9");
  });

  it("uses the leftmost forwarded hop when Cloudflare is absent", () => {
    expect(webhookSourceIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.2" }))).toBe("203.0.113.9");
  });
});
