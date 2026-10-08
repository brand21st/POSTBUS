import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AdminContext } from "@/lib/api/admin-context";
import { loadOpenRouterSettings, saveOpenRouterSettings } from "@/modules/openrouter/admin-settings";

const getPlatformOpenRouterConfig = vi.hoisted(() => vi.fn());
const fetchOpenRouterChatGptModels = vi.hoisted(() => vi.fn());

vi.mock("@/modules/openrouter/platform-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/openrouter/platform-config")>();
  return { ...actual, getPlatformOpenRouterConfig };
});

vi.mock("@/modules/openrouter/chatgpt-models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/openrouter/chatgpt-models")>();
  return { ...actual, fetchOpenRouterChatGptModels };
});

const ctx: AdminContext = { userId: "admin-1", email: "admin@example.com" };

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("GET/PATCH /api/admin/settings/openrouter", () => {
  beforeEach(() => {
    fetchOpenRouterChatGptModels.mockResolvedValue([]);
    getPlatformOpenRouterConfig.mockResolvedValue({
      enabled: false,
      flagEnabled: false,
      apiKey: "",
      model: "openai/gpt-4o-mini",
      source: "none",
      packSize: 500,
      packPaise: 9900,
    });
  });

  it("GET returns masked status and never a raw key", async () => {
    getPlatformOpenRouterConfig.mockResolvedValue({
      enabled: true,
      flagEnabled: true,
      apiKey: "sk-or-v1-secret-value-xyz",
      model: "openai/gpt-4o-mini",
      source: "database",
      packSize: 500,
      packPaise: 9900,
    });
    const result = (await loadOpenRouterSettings()) as Record<string, unknown>;

    expect(result.hasApiKey).toBe(true);
    expect(result.connected).toBe(true);
    expect(Array.isArray(result.models)).toBe(true);
    expect(result.models as Array<{ id: string }>).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "openai/gpt-4o-mini" })])
    );
    expect(String(result.keyMasked)).not.toContain("secret-value");
    expect(JSON.stringify(result)).not.toContain("sk-or-v1-secret-value-xyz");
  });

  it("PATCH encrypts the key into platform_settings and does not store plaintext", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const supabase = {
      from: (table: string) => {
        if (table === "billing_audit_logs") {
          return { insert: async () => ({ error: null }) };
        }
        expect(table).toBe("platform_settings");
        return {
          update: (patch: Record<string, unknown>) => {
            updates.push(patch);
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      },
    };

    await saveOpenRouterSettings(
      jsonRequest("http://localhost:3000/api/admin/settings/openrouter", "PATCH", {
        enabled: true,
        model: "openai/gpt-4o-mini",
        apiKey: "sk-or-v1-new-key-123456",
      }),
      supabase as never,
      ctx
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]?.openrouter_enabled).toBe(true);
    expect(updates[0]?.openrouter_model).toBe("openai/gpt-4o-mini");
    const stored = String(updates[0]?.encrypted_openrouter_api_key ?? "");
    expect(stored).toContain(".");
    expect(stored).not.toContain("sk-or-v1-new-key-123456");
  });
});
