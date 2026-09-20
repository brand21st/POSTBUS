import { describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import { signWebhook } from "@/modules/webhooks/outgoing";

describe("outgoing webhook signatures", () => {
  it("signs timestamp and body with the recoverable secret", () => {
    const timestamp = "1710000000000";
    const body = JSON.stringify({ event: "shipment.updated" });
    const digest = createHmac("sha256", "endpoint-secret").update(`${timestamp}.${body}`).digest("hex");
    expect(signWebhook("endpoint-secret", timestamp, body)).toBe(digest);
    expect(signWebhook("wrong", timestamp, body)).not.toBe(digest);
  });
});
