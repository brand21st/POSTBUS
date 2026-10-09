import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppError } from "@/lib/api/errors";
import { assertSupportCanEnable, loadSupportSettings } from "@/modules/support/flag";

vi.mock("@/modules/support/provider", async () => {
  const actual = await vi.importActual<typeof import("@/modules/support/provider")>("@/modules/support/provider");
  return {
    ...actual,
    isGlobalSupportMessagingEnabled: async () => true,
  };
});

describe("loadSupportSettings", () => {
  it("defaults mode to postbus_global and does not require a merchant key", async () => {
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data:
                table === "organizations"
                  ? { support_center_enabled: true, support_whatsapp_mode: null }
                  : { id: null, status: "NOT_CONNECTED", encrypted_api_key: null },
            }),
          }),
        }),
      }),
    };
    const settings = await loadSupportSettings(supabase as never, "org-1");
    expect(settings.mode).toBe("postbus_global");
    expect(settings.enabled).toBe(true);
    expect(settings.vachatReady).toBe(false);
  });

  it("preserves merchant_vachat when Support Center is on with a CONNECTED key", async () => {
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data:
                table === "organizations"
                  ? { support_center_enabled: true, support_whatsapp_mode: "merchant_vachat" }
                  : { id: "c1", status: "CONNECTED", encrypted_api_key: "enc" },
            }),
          }),
        }),
      }),
    };
    const settings = await loadSupportSettings(supabase as never, "org-1");
    expect(settings.mode).toBe("merchant_vachat");
    expect(settings.enabled).toBe(true);
    expect(settings.vachatReady).toBe(true);
  });
});

describe("assertSupportCanEnable", () => {
  it("refuses merchant mode without a ready connection", () => {
    expect(() =>
      assertSupportCanEnable(
        {
          enabled: false,
          flagged: false,
          mode: "merchant_vachat",
          vachatReady: false,
          globalSupport: true,
          vachatConnectionId: null,
          vachatStatus: "NOT_CONNECTED",
        },
        "merchant_vachat"
      )
    ).toThrow(AppError);
  });
});

describe("support vs shipping credential isolation", () => {
  it("keeps shipping notify on resolveVachatSendCredentials and support send off it", () => {
    const supportSend = readFileSync(resolve(process.cwd(), "modules/support/send.ts"), "utf8");
    const shippingSend = readFileSync(resolve(process.cwd(), "modules/vachat/send.ts"), "utf8");
    expect(supportSend).toContain("resolveSupportProvider");
    expect(supportSend).not.toContain("resolveVachatSendCredentials");
    expect(shippingSend).toContain("resolveVachatSendCredentials");
  });
});
