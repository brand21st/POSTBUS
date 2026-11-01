import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import type { AppError } from "@/lib/api/errors";
import { SHOPIFY_RETRY_INVALID_SESSION_HEADER } from "@/lib/shopify-app/constants";
import { readBearerToken } from "@/lib/shopify-app/id-token";

const CLIENT_ID = "public-app-client-id";
const SECRET = "public-app-client-secret";

async function loadVerifier() {
  vi.resetModules();
  vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", SECRET);
  vi.stubEnv("SHOPIFY_EMBEDDED_APP_ENABLED", "true");
  const [{ verifyShopifyIdToken }, { AppError }] = await Promise.all([
    import("@/lib/shopify-app/id-token"),
    import("@/lib/api/errors"),
  ]);
  return { verifyShopifyIdToken, AppError };
}

async function signToken(claims: Record<string, unknown>, secret = SECRET) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(new TextEncoder().encode(secret));
}

describe("Shopify ID token", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("accepts a valid HS256 token", async () => {
    const { verifyShopifyIdToken } = await loadVerifier();
    const token = await signToken({
      iss: "https://demo-store.myshopify.com/admin",
      dest: "https://demo-store.myshopify.com",
      aud: CLIENT_ID,
      sub: "123",
      exp: Math.floor(Date.now() / 1000) + 60,
      nbf: Math.floor(Date.now() / 1000) - 5,
    });
    const claims = await verifyShopifyIdToken(token);
    expect(claims.shopDomain).toBe("demo-store.myshopify.com");
    expect(claims.userId).toBe("123");
  });

  it("rejects the wrong signature", async () => {
    const { verifyShopifyIdToken, AppError } = await loadVerifier();
    const token = await signToken(
      {
        iss: "https://demo-store.myshopify.com/admin",
        dest: "https://demo-store.myshopify.com",
        aud: CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "other-secret"
    );
    await expect(verifyShopifyIdToken(token)).rejects.toBeInstanceOf(AppError);
  });

  it("rejects an expired token and asks App Bridge to retry", async () => {
    const { verifyShopifyIdToken, AppError } = await loadVerifier();
    const token = await signToken({
      iss: "https://demo-store.myshopify.com/admin",
      dest: "https://demo-store.myshopify.com",
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) - 30,
      nbf: Math.floor(Date.now() / 1000) - 120,
    });
    try {
      await verifyShopifyIdToken(token);
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).headers?.[SHOPIFY_RETRY_INVALID_SESSION_HEADER]).toBe("1");
    }
  });

  it("rejects the wrong audience", async () => {
    const { verifyShopifyIdToken, AppError } = await loadVerifier();
    const token = await signToken({
      iss: "https://demo-store.myshopify.com/admin",
      dest: "https://demo-store.myshopify.com",
      aud: "some-other-app",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    await expect(verifyShopifyIdToken(token)).rejects.toBeInstanceOf(AppError);
  });

  it("rejects issuer and destination mismatch", async () => {
    const { verifyShopifyIdToken, AppError } = await loadVerifier();
    const token = await signToken({
      iss: "https://shop-a.myshopify.com/admin",
      dest: "https://shop-b.myshopify.com",
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    await expect(verifyShopifyIdToken(token)).rejects.toBeInstanceOf(AppError);
  });

  it("rejects a future nbf", async () => {
    const { verifyShopifyIdToken, AppError } = await loadVerifier();
    const token = await signToken({
      iss: "https://demo-store.myshopify.com/admin",
      dest: "https://demo-store.myshopify.com",
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 600,
      nbf: Math.floor(Date.now() / 1000) + 120,
    });
    await expect(verifyShopifyIdToken(token)).rejects.toBeInstanceOf(AppError);
  });

  it("rejects a malformed token and a missing token", async () => {
    const { verifyShopifyIdToken, AppError } = await loadVerifier();
    await expect(verifyShopifyIdToken("not-a-jwt")).rejects.toBeInstanceOf(AppError);
    await expect(verifyShopifyIdToken("")).rejects.toBeInstanceOf(AppError);
  });

  it("parses bearer headers", () => {
    expect(readBearerToken("Bearer abc")).toBe("abc");
    expect(readBearerToken("abc")).toBe("abc");
    expect(readBearerToken(null)).toBe("");
  });
});
