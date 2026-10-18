import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  signWebhook,
  webhookSignatureHeader,
  webhookSignaturesMatch,
  webhookTimestampFresh,
} from "@/modules/webhooks/sign";

describe("webhook signatures", () => {
  it("covers timestamp, event id, and raw body", () => {
    const body = JSON.stringify({ id: "evt_1", type: "shipment.delivered" });
    const hex = signWebhook("secret", "1710000000000", "evt_1", body);
    expect(hex).toBe(createHmac("sha256", "secret").update("1710000000000.evt_1." + body).digest("hex"));
    expect(webhookSignatureHeader("secret", "1710000000000", "evt_1", body)).toBe(`v1=${hex}`);
  });

  it("accepts v1= prefix with constant-time compare and rejects mismatches", () => {
    const hex = signWebhook("secret", "1", "evt", "{}");
    expect(webhookSignaturesMatch(hex, `v1=${hex}`)).toBe(true);
    expect(webhookSignaturesMatch(hex, hex)).toBe(true);
    expect(webhookSignaturesMatch(hex, "v1=deadbeef")).toBe(false);
  });

  it("rejects expired timestamps", () => {
    expect(webhookTimestampFresh(String(Date.now()), Date.now())).toBe(true);
    expect(webhookTimestampFresh(String(Date.now() - 6 * 60 * 1000), Date.now())).toBe(false);
  });
});
