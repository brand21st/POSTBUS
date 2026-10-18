import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MERCHANT_V1_ROUTES, merchantOpenApiDocument } from "@/modules/merchant-api/openapi-document";

describe("Merchant API OpenAPI contract", () => {
  it("lists every documented route and keeps methods unique per path", () => {
    const spec = merchantOpenApiDocument();
    for (const route of MERCHANT_V1_ROUTES) {
      const pathItem = spec.paths[route.path] as Record<string, unknown> | undefined;
      expect(pathItem, route.path).toBeTruthy();
      expect(pathItem?.[route.method.toLowerCase()], `${route.method} ${route.path}`).toBeTruthy();
    }
  });

  it("does not document DELETE /orders", () => {
    expect(MERCHANT_V1_ROUTES.some((route) => route.method === "DELETE" && route.path.startsWith("/orders"))).toBe(
      false
    );
  });

  it("rejects production-looking secrets in merchant docs", () => {
    const files = [
      "docs/merchant-api/POSTBUS_API_REFERENCE.md",
      "docs/merchant-api/GOOGLE_APPS_SCRIPT_EXAMPLE.md",
      "docs/merchant-api/POSTBUS_AI_INTEGRATION_GUIDE.md",
      "docs/merchant-api/ENDPOINT_INVENTORY.md",
      "docs/merchant-api/openapi.yaml",
    ];
    for (const file of files) {
      const text = readFileSync(join(process.cwd(), file), "utf8");
      expect(text).not.toMatch(/pb_live_[a-f0-9]{16}_[a-f0-9]{32}/i);
      expect(text).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY=\S+/);
    }
  });
});
