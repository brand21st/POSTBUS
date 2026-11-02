import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getPlatformVachatConfig: vi.fn(),
  isPlatformVachatActive: vi.fn(),
  createBackgroundJob: vi.fn(),
  hasAdminClient: vi.fn(),
  createAdminClient: vi.fn(),
  sendVachatPlatformTemplate: vi.fn(),
}));

vi.mock("@/modules/vachat/platform-config", () => ({
  getPlatformVachatConfig: (...args: unknown[]) => h.getPlatformVachatConfig(...args),
  isPlatformVachatActive: (...args: unknown[]) => h.isPlatformVachatActive(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasAdminClient: () => h.hasAdminClient(),
  createAdminClient: () => h.createAdminClient(),
}));

vi.mock("@/modules/jobs/service", () => ({
  createBackgroundJob: (...args: unknown[]) => h.createBackgroundJob(...args),
}));

vi.mock("@/modules/vachat/send", async () => {
  const actual = await vi.importActual<typeof import("@/modules/vachat/send")>("@/modules/vachat/send");
  return {
    ...actual,
    sendVachatPlatformTemplate: (...args: unknown[]) => h.sendVachatPlatformTemplate(...args),
  };
});

import { deliverSignupWelcome, enqueueSignupWelcome, signupWelcomeExternalRef } from "@/modules/vachat/signup-welcome";

function platform() {
  return {
    signupWelcomeEnabled: true,
    signupWelcomeTemplateName: "signup_hello",
    signupWelcomeTemplateLanguage: "en",
  };
}

describe("enqueueSignupWelcome", () => {
  beforeEach(() => {
    h.getPlatformVachatConfig.mockReset();
    h.isPlatformVachatActive.mockReset();
    h.createBackgroundJob.mockReset();
    h.hasAdminClient.mockReturnValue(true);
    h.sendVachatPlatformTemplate.mockReset();
  });

  it("skips when the template is unset or platform is inactive", async () => {
    h.getPlatformVachatConfig.mockResolvedValue({ ...platform(), signupWelcomeTemplateName: "" });
    h.isPlatformVachatActive.mockReturnValue(true);
    expect(await enqueueSignupWelcome("u1", "org-1")).toEqual({ queued: false });
    expect(h.createBackgroundJob).not.toHaveBeenCalled();
  });

  it("skips when already sent or phone is missing", async () => {
    h.getPlatformVachatConfig.mockResolvedValue(platform());
    h.isPlatformVachatActive.mockReturnValue(true);
    h.createAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { whatsapp_number: null, full_name: "A", signup_welcome_sent_at: null },
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null }) }),
            }),
          }),
        };
      },
    });
    expect(await enqueueSignupWelcome("u1", "org-1")).toEqual({ queued: false, reason: "missing_phone" });
    expect(h.createBackgroundJob).not.toHaveBeenCalled();
  });

  it("queues a signup_welcome job", async () => {
    h.getPlatformVachatConfig.mockResolvedValue(platform());
    h.isPlatformVachatActive.mockReturnValue(true);
    h.createBackgroundJob.mockResolvedValue({ id: "job-1" });
    const upsert = vi.fn(async () => ({ error: null }));
    h.createAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    whatsapp_number: "+919876543210",
                    full_name: "Priya",
                    signup_welcome_sent_at: null,
                  },
                }),
              }),
            }),
          };
        }
        if (table === "vachat_notification_logs") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: null }) }),
              }),
            }),
            upsert,
          };
        }
        return {};
      },
    });
    expect(await enqueueSignupWelcome("u1", "org-1")).toEqual({ queued: true });
    expect(h.createBackgroundJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobType: "vachat-notify",
        entityId: "u1",
        progress: expect.objectContaining({
          kind: "signup_welcome",
          templateName: "signup_hello",
          variables: ["Priya"],
        }),
      })
    );
  });
});

describe("deliverSignupWelcome", () => {
  beforeEach(() => {
    h.sendVachatPlatformTemplate.mockReset();
  });

  it("does not call sendVachatNotice and marks the profile after send", async () => {
    h.sendVachatPlatformTemplate.mockResolvedValue({ sent: true, messageId: "m1" });
    const update = vi.fn(() => ({ eq: async () => ({ error: null }) }));
    const upsert = vi.fn(async () => ({ error: null }));
    const supabase = {
      from: (table: string) => {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { signup_welcome_sent_at: null } }) }),
            }),
            update,
          };
        }
        if (table === "vachat_notification_logs") {
          return { upsert };
        }
        return {};
      },
    };
    const result = await deliverSignupWelcome(supabase as never, "org-1", {
      userId: "u1",
      to: "+919876543210",
      templateName: "signup_hello",
      language: "en",
      variables: ["Priya"],
    });
    expect(result).toEqual({ sent: true, messageId: "m1" });
    expect(h.sendVachatPlatformTemplate).toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });

  it("skips send when already delivered", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { signup_welcome_sent_at: "2026-10-22T00:00:00Z" } }) }),
        }),
      }),
    };
    expect(
      await deliverSignupWelcome(supabase as never, "org-1", {
        userId: "u1",
        to: "+919876543210",
        templateName: "signup_hello",
      })
    ).toEqual({ sent: false, reason: "already_sent" });
    expect(h.sendVachatPlatformTemplate).not.toHaveBeenCalled();
  });
});

describe("signupWelcomeExternalRef", () => {
  it("is unique per user", () => {
    expect(signupWelcomeExternalRef("u1")).toBe("postbus:signup_welcome:u1");
  });
});
