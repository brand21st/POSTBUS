import { createHmac } from "crypto";
import { safeEqual } from "@/lib/security/crypto";

export function verifyShopifyAppWebhookHmac(rawBody: string, header: string | null, clientSecret: string) {
  if (!header || !clientSecret) return false;
  const digest = createHmac("sha256", clientSecret).update(rawBody, "utf8").digest("base64");
  return safeEqual(digest, header.trim());
}
