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
  merchantVachatRowReady: (row?: { encrypted_api_key?: string | null; status?: string | null } | null) =>
    Boolean(row?.encrypted_api_key) && String(row?.status ?? "").toUpperCase() === "CONNECTED",
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

import { enqueueVachatNotify } from "@/modules/vachat/send";

describe("enqueueVachatNotify", () => {
  beforeEach(() => {
    h.getPlatformVachatConfig.mockReset();
    h.isPlatformVachatActive.mockReset();
    h.resolveVachatSendCredentials.mockReset();
    h.isAutoWatiEventEnabled.mockReset();
    h.createBackgroundJob.mockReset();
  });

  it("does not enqueue VaChat when WATI is connected", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { status: "CONNECTED" } }),
          }),
        }),
      }),
    };
    await enqueueVachatNotify(supabase as never, "org-1", "booked", { shipmentId: "s1" });
    expect(h.isAutoWatiEventEnabled).not.toHaveBeenCalled();
    expect(h.createBackgroundJob).not.toHaveBeenCalled();
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
    expect(h.isAutoWatiEventEnabled).not.toHaveBeenCalled();
    expect(h.resolveVachatSendCredentials).not.toHaveBeenCalled();
    expect(h.createBackgroundJob).not.toHaveBeenCalled();
  });

  it("skips when Super Admin enabled the event but this workspace turned the stage off", async () => {
    h.getPlatformVachatConfig.mockResolvedValue({
      enabled: true,
      eventSettings: { booked: true },
    });
    h.isPlatformVachatActive.mockReturnValue(true);
    h.isAutoWatiEventEnabled.mockResolvedValue(false);
    const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) };
    await enqueueVachatNotify(supabase as never, "org-1", "booked", { shipmentId: "s1" });
    expect(h.isAutoWatiEventEnabled).toHaveBeenCalledWith(expect.anything(), "org-1", "booked");
    expect(h.createBackgroundJob).not.toHaveBeenCalled();
  });

  it("enqueues when Super Admin and this workspace both enable the stage", async () => {
    h.getPlatformVachatConfig.mockResolvedValue({
      enabled: true,
      eventSettings: { booked: true },
    });
    h.isPlatformVachatActive.mockReturnValue(true);
    h.isAutoWatiEventEnabled.mockResolvedValue(true);
    h.resolveVachatSendCredentials.mockResolvedValue({
      source: "platform",
      apiKey: "k",
      apiBaseUrl: "https://cloud.vachat.in",
    });
    const supabase = {
      from: () => {
        const api: Record<string, unknown> = {};
        api.select = () => api;
        api.eq = () => api;
        api.in = () => api;
        api.maybeSingle = async () => ({ data: null });
        api.then = (resolve: (value: { data: unknown[] }) => unknown) =>
          Promise.resolve({ data: [] }).then(resolve);
        return api;
      },
    };
    await enqueueVachatNotify(supabase as never, "org-1", "booked", { shipmentId: "s1" });
    expect(h.createBackgroundJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobType: "vachat-notify",
        entityId: "s1",
        progress: { event: "booked", shipmentId: "s1", orderId: null },
      })
    );
  });

  it("enqueues merchant VaChat even when Super Admin PostBus events are off", async () => {
    h.getPlatformVachatConfig.mockResolvedValue({
      enabled: true,
      eventSettings: { booked: false },
    });
    h.isPlatformVachatActive.mockReturnValue(true);
    h.isAutoWatiEventEnabled.mockResolvedValue(true);
    h.resolveVachatSendCredentials.mockResolvedValue({
      source: "organization",
      apiKey: "merchant-k",
      apiBaseUrl: "https://cloud.vachat.in",
    });
    const supabase = {
      from: (table: string) => {
        const api: Record<string, unknown> = {};
        api.select = () => api;
        api.eq = () => api;
        api.in = () => api;
        api.maybeSingle = async () =>
          table === "vachat_connections"
            ? { data: { status: "CONNECTED", encrypted_api_key: "enc" } }
            : { data: null };
        api.then = (resolve: (value: { data: unknown[] }) => unknown) =>
          Promise.resolve({ data: [] }).then(resolve);
        return api;
      },
    };
    await enqueueVachatNotify(supabase as never, "org-1", "booked", { shipmentId: "s1" });
    expect(h.createBackgroundJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ jobType: "vachat-notify", entityId: "s1" })
    );
  });
});
