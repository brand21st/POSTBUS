import { describe, expect, it } from "vitest";
import { WebhookUrlError, assertPublicHttpsUrl, isBlockedIp } from "@/modules/webhooks/ssrf";

describe("webhook SSRF", () => {
  it("blocks loopback, private, link-local, CGNAT, and metadata-style IPs", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
    expect(isBlockedIp("172.16.4.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("100.64.1.1")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });

  it("rejects non-HTTPS, credentials, localhost hostnames, and raw private IPs", async () => {
    await expect(assertPublicHttpsUrl("http://example.com/hook")).rejects.toBeInstanceOf(WebhookUrlError);
    await expect(assertPublicHttpsUrl("https://user:pass@example.com/hook")).rejects.toBeInstanceOf(WebhookUrlError);
    await expect(assertPublicHttpsUrl("https://127.0.0.1/hook")).rejects.toBeInstanceOf(WebhookUrlError);
    await expect(assertPublicHttpsUrl("https://metadata.google.internal/")).rejects.toBeInstanceOf(WebhookUrlError);
  });

  it("rejects DNS answers that include a blocked address", async () => {
    await expect(
      assertPublicHttpsUrl("https://merchant.example.com/webhooks", async () => [
        { address: "1.1.1.1", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ])
    ).rejects.toThrow(/blocked address/);
  });

  it("accepts a public HTTPS host whose DNS is public", async () => {
    const result = await assertPublicHttpsUrl("https://merchant.example.com/webhooks/postbus", async () => [
      { address: "1.1.1.1", family: 4 },
    ]);
    expect(result.url.hostname).toBe("merchant.example.com");
  });
});
