import { describe, expect, it, vi } from "vitest";
import { logInfo, redact } from "@/lib/logger";

describe("timing log redaction", () => {
  it("never leaves access_token in redacted timing fields", () => {
    expect(
      redact({
        event: "india_post.book.completed",
        durationMs: 12,
        organizationId: "org-1",
        access_token: "secret-token",
        queueWaitMs: 40,
      })
    ).toEqual({
      event: "india_post.book.completed",
      durationMs: 12,
      organizationId: "org-1",
      access_token: "[redacted]",
      queueWaitMs: 40,
    });
  });

  it("redacts otp material", () => {
    expect(redact({ otp: "123456", otp_hmac: "abc", phoneLast4: "3210" })).toEqual({
      otp: "[redacted]",
      otp_hmac: "[redacted]",
      phoneLast4: "3210",
    });
  });

  it("redacts access_token when logInfo writes JSON", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logInfo("india_post.book.completed", {
      durationMs: 9,
      access_token: "should-not-appear",
      jobId: "job-1",
    });
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(JSON.stringify(payload)).not.toContain("should-not-appear");
    expect(payload.fields.access_token).toBe("[redacted]");
    spy.mockRestore();
  });

  it("redacts cookies and authorization headers", () => {
    expect(
      redact({
        cookie: "sb-access-token=secret",
        authorization: "Bearer secret",
        "set-cookie": "token=secret",
      })
    ).toEqual({
      cookie: "[redacted]",
      authorization: "[redacted]",
      "set-cookie": "[redacted]",
    });
  });
});
