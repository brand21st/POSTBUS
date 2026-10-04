import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getPlatformVachatConfig: vi.fn(),
  isPlatformVachatActive: vi.fn(),
  resolveVachatSendCredentials: vi.fn(),
  isAutoWatiEventEnabled: vi.fn(),
  createBackgroundJob: vi.fn(),
}));

vi.mock("@/modules/vachat/platform-config", () => ({
  getPlatformVachatConfig: (...args: unknown[]) => h.getPlatformVachatConfig(...args),
  isPlatformVachatActive: (...args: unknown[]) => h.isPlatformVachatActive(...args),
  resolveVachatSendCredentials: (...args: unknown[]) => h.resolveVachatSendCredentials(...args),
}));

vi.mock("@/modules/automation/service", () => ({
  isAutoWatiEventEnabled: (...args: unknown[]) => h.isAutoWatiEventEnabled(...args),
}));

vi.mock("@/modules/jobs/service", () => ({
  createBackgroundJob: (...args: unknown[]) => h.createBackgroundJob(...args),
}));

import { enqueueVachatNotify } from "@/modules/vachat/send";

describe("enqueueVachatNotify", () => {
  beforeEach(() => {
    h.getPlatformVachatConfig.mockReset();
    h.isPlatformVachatActive.mockReset();
    h.resolveVachatSendCredentials.mockReset();
    h.isAutoWatiEventEnabled.mockReset();
    h.createBackgroundJob.mockReset();
  });

  it("skips when platform VaChat is disabled and no org connection exists", async () => {
    h.getPlatformVachatConfig.mockResolvedValue({
      enabled: false,
      eventSettings: { booked: true },
    });
    h.isPlatformVachatActive.mockReturnValue(false);
    h.isAutoWatiEventEnabled.mockResolvedValue(true);
    h.resolveVachatSendCredentials.mockResolvedValue(null);
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null }),
            in: () => ({
              in: async () => ({ data: [] }),
            }),
          }),
        }),
      }),
    };
    await enqueueVachatNotify(supabase as never, "org-1", "booked", { shipmentId: "s1" });
    expect(h.createBackgroundJob).not.toHaveBeenCalled();
  });

  it("skips when the Super Admin event flag is off in global mode", async () => {
    h.getPlatformVachatConfig.mockResolvedValue({
      enabled: true,
      eventSettings: { booked: false },
    });
    h.isPlatformVachatActive.mockReturnValue(true);
    const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) };
    await enqueueVachatNotify(supabase as never, "org-1", "booked", { shipmentId: "s1" });
    expect(h.resolveVachatSendCredentials).not.toHaveBeenCalled();
    expect(h.createBackgroundJob).not.toHaveBeenCalled();
  });
});
