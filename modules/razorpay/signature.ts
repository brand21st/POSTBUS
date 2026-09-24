import { createHmac } from "crypto";
import { safeEqual } from "@/lib/security/crypto";

export function razorpayHmacHex(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyCheckoutSignature(input: {
  paymentId: string;
  subscriptionId: string;
  signature: string;
  secret: string;
}) {
  const expected = razorpayHmacHex(`${input.paymentId}|${input.subscriptionId}`, input.secret);
  return safeEqual(expected, input.signature);
}

export function verifyWebhookSignature(rawBody: string, signature: string, secret: string) {
  const expected = razorpayHmacHex(rawBody, secret);
  return safeEqual(expected, signature);
}
