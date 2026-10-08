import { describe, expect, it } from "vitest";
import { encryptSecret, maskSecret } from "@/lib/security/crypto";
import { hasAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_OPENROUTER_MODEL,
  getPlatformOpenRouterConfig,
  publicOpenRouterStatus,
  sanitizeOpenRouterModel,
} from "@/modules/openrouter/platform-config";

describe("OpenRouter platform settings", () => {
  it("rejects unsafe model ids", () => {
    expect(sanitizeOpenRouterModel("openai/gpt-4o-mini")).toBe("openai/gpt-4o-mini");
    expect(sanitizeOpenRouterModel("drop table;")).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(sanitizeOpenRouterModel("anthropic/claude-3.5-sonnet")).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(sanitizeOpenRouterModel("")).toBe(DEFAULT_OPENROUTER_MODEL);
  });

  it("masks the configured key and never returns the secret", () => {
    const apiKey = "sk-or-v1-abcdefghijklmnop";
    const encrypted = encryptSecret(apiKey);
    expect(encrypted).not.toContain(apiKey);
    const status = publicOpenRouterStatus({
      enabled: true,
      flagEnabled: true,
      apiKey,
      model: DEFAULT_OPENROUTER_MODEL,
      source: "database",
      packSize: 500,
      packPaise: 9900,
    });
    expect(status.hasApiKey).toBe(true);
    expect(status.connected).toBe(true);
    expect(status.keyMasked).toBe(maskSecret(apiKey));
    expect(status.keyMasked).not.toContain("abcdefgh");
    expect(JSON.stringify(status)).not.toContain(apiKey);
  });

  it("loads OpenRouter flags from platform_settings", async () => {
    if (!hasAdminClient()) return;
    const config = await getPlatformOpenRouterConfig();
    expect(typeof config.enabled).toBe("boolean");
    expect(typeof config.flagEnabled).toBe("boolean");
    expect(config.model.length).toBeGreaterThan(0);
    const status = publicOpenRouterStatus(config);
    if (config.apiKey) {
      expect(JSON.stringify(status)).not.toContain(config.apiKey);
    }
  });
});

