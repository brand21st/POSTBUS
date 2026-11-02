import { describe, expect, it } from "vitest";
import { fingerprintBody, idempotencyStorageKey } from "@/modules/merchant-api/idempotency";

describe("merchant idempotency helpers", () => {
  it("namespaces keys so they cannot collide with WhatsApp rows", () => {
    expect(idempotencyStorageKey("orders.create", "abc")).toBe("merchant-api:v1:orders.create:abc");
  });

  it("fingerprints bodies stably and detects conflict payloads", () => {
    const a = fingerprintBody({ pincode: "560001", name: "A" });
    const b = fingerprintBody({ pincode: "560001", name: "A" });
    const c = fingerprintBody({ pincode: "560002", name: "A" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
