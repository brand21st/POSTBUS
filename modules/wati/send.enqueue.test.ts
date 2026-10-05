import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getPlatformVachatConfig: vi.fn(),
  isPlatformVachatActive: vi.fn(),
  isAutoWatiEventEnabled: vi.fn(),
  createBackgroundJob: vi.fn(),
}));

vi.mock("@/modules/vachat/platform-config", () => ({
  getPlatformVachatConfig: (...args: unknown[]) => h.getPlatformVachatConfig(...args),
  isPlatformVachatActive: (...args: unknown[]) => h.isPlatformVachatActive(...args),
}));

vi.mock("@/modules/automation/service", () => ({
  isAutoWatiEventEnabled: (...args: unknown[]) => h.isAutoWatiEventEnabled(...args),
}));

vi.mock("@/modules/jobs/service", () => ({
  createBackgroundJob: (...args: unknown[]) => h.createBackgroundJob(...args),
}));

vi.mock("@/modules/whatsapp/label-gate", () => ({
  canSendIndiaPostWhatsApp: vi.fn(async () => true),
}));

import { enqueueWatiNotify } from "@/modules/wati/send";

describe("enqueueWatiNotify", () => {
  beforeEach(() => {
    h.getPlatformVachatConfig.mockReset();
    h.isPlatformVachatActive.mockReset();
    h.isAutoWatiEventEnabled.mockReset();
    h.createBackgroundJob.mockReset();
  });

  it("uses the WATI connection even when PostBus VaChat is configured", async () => {
    h.getPlatformVachatConfig.mockResolvedValue({ enabled: true, apiKey: "k" });
    h.isPlatformVachatActive.mockReturnValue(true);
    h.isAutoWatiEventEnabled.mockResolvedValue(true);
    const supabase = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null }),
          }),
        }),
      })),
    };
    await enqueueWatiNotify(supabase as never, "org-1", "booked", { shipmentId: "s1" });
    expect(supabase.from).toHaveBeenCalled();
    expect(h.createBackgroundJob).not.toHaveBeenCalled();
  });
});
