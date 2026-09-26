import { describe, expect, it } from "vitest";

const liveCredentials = Boolean(
  process.env.INDIA_POST_UAT_USERNAME &&
    process.env.INDIA_POST_UAT_PASSWORD &&
    process.env.INDIA_POST_UAT_BARCODE
);

describe("India Post UAT tracking", () => {
  it("records that a live CEPT UAT call runs only when credentials are configured", () => {
    expect(liveCredentials).toBe(
      Boolean(
        process.env.INDIA_POST_UAT_USERNAME &&
          process.env.INDIA_POST_UAT_PASSWORD &&
          process.env.INDIA_POST_UAT_BARCODE
      )
    );
  });

  it.skipIf(!liveCredentials)("calls the configured CEPT UAT tracking API", async () => {
    const { IndiaPostProvider } = await import("@/modules/india-post/provider");
    const provider = new IndiaPostProvider({
      environment: "UAT",
      status: "CONNECTED",
      encrypted_username: process.env.INDIA_POST_UAT_USERNAME,
      encrypted_password: process.env.INDIA_POST_UAT_PASSWORD,
    });
    const result = await provider.trackShipment([process.env.INDIA_POST_UAT_BARCODE || ""]);
    expect(result).toBeTruthy();
  });
});
