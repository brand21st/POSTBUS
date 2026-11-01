import { describe, expect, it } from "vitest";
import { isIndiaPostWebhookQuarantined, webhookSourceIp } from "@/modules/india-post/webhook-allowlist";

describe("India Post webhook source identity", () => {
  it("stays quarantined without a CIDR environment variable", () => {
    expect(isIndiaPostWebhookQuarantined()).toBe(true);
  });

  it("prefers cf-connecting-ip over x-forwarded-for", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "10.0.0.1, 10.0.0.2",
    });
    expect(webhookSourceIp(headers)).toBe("203.0.113.9");
  });

  it("ignores a spoofed x-forwarded-for list", () => {
    expect(webhookSourceIp(new Headers({ "x-forwarded-for": "10.9.8.7, 203.0.113.9" }))).toBeNull();
  });

  it("does not let a forwarded header override Cloudflare or the proxy address", () => {
    expect(
      webhookSourceIp(
        new Headers({
          "cf-connecting-ip": "203.0.113.9",
          "x-forwarded-for": "10.9.8.7",
          "x-real-ip": "10.9.8.7",
        })
      )
    ).toBe("203.0.113.9");
    expect(
      webhookSourceIp(
        new Headers({
          "x-real-ip": "203.0.113.40",
          "x-forwarded-for": "10.9.8.7",
        })
      )
    ).toBe("203.0.113.40");
  });
});
