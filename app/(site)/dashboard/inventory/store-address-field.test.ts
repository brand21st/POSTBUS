import { describe, expect, it } from "vitest";
import { toStoreAddress } from "./store-address-field";
import { storeAddressSchema } from "@/modules/storefront/schema";

describe("store address input", () => {
  it("normalizes what merchants type into a URL-safe address", () => {
    expect(toStoreAddress("My Shop!")).toBe("my-shop-");
    expect(toStoreAddress("Café  Déco")).toBe("cafe-deco");
    expect(toStoreAddress("--kala--ghar")).toBe("kala-ghar");
    expect(toStoreAddress("x".repeat(60))).toHaveLength(48);
  });

  it("matches what the server accepts once trailing hyphens are trimmed", () => {
    for (const raw of ["My Shop!", "Café Déco", "Kala Ghar 2"]) {
      const slug = toStoreAddress(raw).replace(/-+$/, "");
      expect(storeAddressSchema.safeParse({ slug }).success).toBe(true);
    }
    expect(storeAddressSchema.safeParse({ slug: "store" }).success).toBe(false);
    expect(storeAddressSchema.safeParse({ slug: "a--b" }).success).toBe(false);
  });
});
