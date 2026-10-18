import { describe, expect, it, vi } from "vitest";
import { nextRetryDelayMs, redactDeliveryExcerpt, runWebhookProcessing } from "@/modules/webhooks/deliver";

describe("webhook delivery", () => {
  it("schedules exponential backoff then stops after six attempts", () => {
    expect(nextRetryDelayMs(1)).toBe(60_000);
    expect(nextRetryDelayMs(2)).toBe(300_000);
    expect(nextRetryDelayMs(5)).toBe(28_800_000);
  });

  it("redacts key-like strings from response excerpts", () => {
    expect(redactDeliveryExcerpt("ok pb_live_abcd_secretvalue leftover")).toContain("[redacted]");
    expect(redactDeliveryExcerpt("ok pb_live_abcd_secretvalue leftover")).not.toContain("secretvalue");
  });

  it("skips fan-out when the org is not allowlisted", async () => {
    process.env.MERCHANT_WEBHOOKS_ENABLED = "true";
    process.env.MERCHANT_WEBHOOKS_ORG_ALLOWLIST = "";
    const update = vi.fn(async () => ({ error: null }));
    const supabase = {
      from(table: string) {
        if (table === "webhook_events") {
          return { update: (values: unknown) => ({ eq: () => ({ eq: () => update(values) }) }) };
        }
        return {};
      },
    };
    await runWebhookProcessing(supabase as never, "11111111-1111-4111-8111-111111111111");
    expect(update).toHaveBeenCalledWith({ status: "SKIPPED" });
    delete process.env.MERCHANT_WEBHOOKS_ENABLED;
    delete process.env.MERCHANT_WEBHOOKS_ORG_ALLOWLIST;
  });
});
