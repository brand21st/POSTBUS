import { describe, expect, it } from "vitest";
import { merchantSupportHref } from "./customer-support";

describe("merchantSupportHref", () => {
  it("prefers WhatsApp, then phone, then email, then website", () => {
    expect(
      merchantSupportHref({
        whatsapp: "8848772371",
        phone: "04936221234",
        email: "hello@shop.test",
        social: { website: "https://shop.test" },
      })
    ).toBe("https://wa.me/918848772371");
    expect(
      merchantSupportHref({
        whatsapp: null,
        phone: "04936221234",
        email: "hello@shop.test",
        social: { website: "https://shop.test" },
      })
    ).toBe("tel:04936221234");
    expect(
      merchantSupportHref({
        whatsapp: null,
        phone: null,
        email: "hello@shop.test",
        social: {},
      })
    ).toBe("mailto:hello@shop.test");
  });
});
