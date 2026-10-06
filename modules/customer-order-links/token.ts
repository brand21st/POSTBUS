import { randomBytes } from "crypto";
import { CUSTOMER_ORDER_LINK_TOKEN } from "@/modules/customer-order-links/schema";

/** No 0/O/1/I/L so the code is easy to read aloud and type. */
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function createCustomerOrderLinkToken() {
  const bytes = randomBytes(16);
  const chars: string[] = [];
  for (let i = 0; i < 16; i++) {
    chars.push(ALPHABET[bytes[i]! % ALPHABET.length]!);
  }
  const token = `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12, 16).join("")}`;
  if (!CUSTOMER_ORDER_LINK_TOKEN.test(token)) {
    throw new Error("Failed to create a customer order link token.");
  }
  return token;
}
