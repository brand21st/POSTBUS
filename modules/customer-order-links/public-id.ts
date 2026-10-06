import { createHash } from "crypto";
import { CUSTOMER_ORDER_PUBLIC_ID } from "@/modules/customer-order-links/schema";

const HASH_PREFIX = "postbus.customer-order.org-id.v1:";

export function hashedCustomerOrderPublicId(organizationId: string, attempt = 0) {
  const digest = createHash("sha256").update(`${HASH_PREFIX}${organizationId}:${attempt}`).digest();
  return String(digest.readUInt32BE(0) % 10_000).padStart(4, "0");
}

export function isCustomerOrderPublicId(value: string | null | undefined): value is string {
  return Boolean(value && CUSTOMER_ORDER_PUBLIC_ID.test(value));
}
