import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { verifyCheckoutSignature, verifyOrderCheckoutSignature, verifyWebhookSignature } from "@/modules/razorpay/signature";

const secret = "whsec_test";

describe("razorpay signatures", () => {
  it("accepts a valid order checkout signature and rejects a tampered one", () => {
    const paymentId = "pay_123";
    const orderId = "order_789";
    const signature = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
    expect(verifyOrderCheckoutSignature({ orderId, paymentId, signature, secret })).toBe(true);
    expect(
      verifyOrderCheckoutSignature({ orderId, paymentId, signature: "a".repeat(signature.length), secret })
    ).toBe(false);
  });

  it("accepts a valid subscription checkout signature", () => {
    const paymentId = "pay_123";
    const subscriptionId = "sub_456";
    const signature = createHmac("sha256", secret).update(`${paymentId}|${subscriptionId}`).digest("hex");
    expect(verifyCheckoutSignature({ paymentId, subscriptionId, signature, secret })).toBe(true);
  });

  it("verifies webhook HMAC over the raw body", () => {
    const body = JSON.stringify({ event: "subscription.charged" });
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyWebhookSignature(body + " ", signature, secret)).toBe(false);
  });
});
