import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api/errors";
import { encryptSecret } from "@/lib/security/crypto";

const platform = vi.hoisted(() => ({
  getPlatformVachatConfig: vi.fn(),
  isPlatformVachatActive: vi.fn(),
}));

vi.mock("@/modules/vachat/platform-config", async () => {
  const actual = await vi.importActual<typeof import("@/modules/vachat/platform-config")>(
    "@/modules/vachat/platform-config"
  );
  return {
    ...actual,
    getPlatformVachatConfig: (...args: unknown[]) => platform.getPlatformVachatConfig(...args),
    isPlatformVachatActive: (...args: unknown[]) => platform.isPlatformVachatActive(...args),
  };
});

function supabaseFor(org: Record<string, unknown>, connection: Record<string, unknown> | null) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "organizations" ? org : connection,
          }),
        }),
      }),
    }),
  };
}

describe("resolveSupportProvider", () => {
  beforeEach(() => {
    platform.getPlatformVachatConfig.mockReset();
    platform.isPlatformVachatActive.mockReset();
  });

  it("defaults missing mode to postbus_global and uses the platform key", async () => {
    const { resolveSupportProvider } = await import("@/modules/support/provider");
    platform.isPlatformVachatActive.mockReturnValue(true);
    platform.getPlatformVachatConfig.mockResolvedValue({
      enabled: true,
      supportEnabled: true,
      apiKey: "platform-key",
      apiBaseUrl: "https://cloud.vachat.in",
    });
    const creds = await resolveSupportProvider(
      supabaseFor({ support_center_enabled: true, support_whatsapp_mode: null }, null) as never,
      "org-1"
    );
    expect(creds).toMatchObject({ mode: "postbus_global", source: "platform", apiKey: "platform-key" });
  });

  it("uses the merchant key in merchant_vachat mode", async () => {
    const { resolveSupportProvider } = await import("@/modules/support/provider");
    const creds = await resolveSupportProvider(
      supabaseFor(
        { support_center_enabled: true, support_whatsapp_mode: "merchant_vachat" },
        {
          id: "c1",
          encrypted_api_key: encryptSecret("merchant-key"),
          api_base_url: "https://cloud.vachat.in",
          status: "CONNECTED",
        }
      ) as never,
      "org-1"
    );
    expect(creds).toMatchObject({ mode: "merchant_vachat", source: "organization", apiKey: "merchant-key" });
    expect(platform.getPlatformVachatConfig).not.toHaveBeenCalled();
  });

  it("does not silently fall back to PostBus WhatsApp when the merchant connection is not ready", async () => {
    const { resolveSupportProvider } = await import("@/modules/support/provider");
    platform.isPlatformVachatActive.mockReturnValue(true);
    platform.getPlatformVachatConfig.mockResolvedValue({
      enabled: true,
      supportEnabled: true,
      apiKey: "platform-key",
      apiBaseUrl: "https://cloud.vachat.in",
    });
    await expect(
      resolveSupportProvider(
        supabaseFor(
          { support_center_enabled: true, support_whatsapp_mode: "merchant_vachat" },
          { encrypted_api_key: "not-valid", status: "CONNECTED" }
        ) as never,
        "org-1"
      )
    ).rejects.toBeInstanceOf(AppError);
    expect(platform.getPlatformVachatConfig).not.toHaveBeenCalled();
  });
});
