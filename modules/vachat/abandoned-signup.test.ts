import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getPlatformVachatConfig: vi.fn(),
  isPlatformVachatActive: vi.fn(),
  hasAdminClient: vi.fn(),
  createAdminClient: vi.fn(),
  sendVachatPlatformTemplate: vi.fn(),
  sendVachatNotice: vi.fn(),
}));

vi.mock("@/modules/vachat/platform-config", () => ({
  getPlatformVachatConfig: (...args: unknown[]) => h.getPlatformVachatConfig(...args),
  isPlatformVachatActive: (...args: unknown[]) => h.isPlatformVachatActive(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasAdminClient: () => h.hasAdminClient(),
  createAdminClient: () => h.createAdminClient(),
}));

vi.mock("@/modules/vachat/send", async () => {
  const actual = await vi.importActual<typeof import("@/modules/vachat/send")>("@/modules/vachat/send");
  return {
    ...actual,
    sendVachatPlatformTemplate: (...args: unknown[]) => h.sendVachatPlatformTemplate(...args),
    sendVachatNotice: (...args: unknown[]) => h.sendVachatNotice(...args),
  };
});

import {
  abandonedSignupExternalRef,
  deliverAbandonedSignup,
  enqueueAbandonedSignup,
  sweepAbandonedSignups,
} from "@/modules/vachat/abandoned-signup";

function platform() {
  return {
    abandonedSignupEnabled: true,
    abandonedSignupTemplateName: "abandoned_hello",
    abandonedSignupTemplateLanguage: "en",
  };
}

function supabaseMock(input: {
  profile?: Record<string, unknown> | null;
  log?: { id: string; status: string } | null;
  user?: { email_confirmed_at?: string | null; phone_confirmed_at?: string | null } | null;
  abandoned?: Array<{ id: string; full_name: string | null; whatsapp_number: string | null }>;
  sentIds?: string[];
}) {
  const update = vi.fn(() => ({ eq: async () => ({ error: null }) }));
  const insert = vi.fn(async () => ({ error: null }));
  const upsert = vi.fn(async () => ({ error: null }));
  return {
    update,
    insert,
    upsert,
    client: {
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: input.user === undefined ? { email_confirmed_at: null, phone_confirmed_at: null } : input.user },
            error: input.user === null ? { message: "missing" } : null,
          }),
        },
      },
      from: (table: string) => {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: input.profile ?? {
                    whatsapp_number: "+919876543210",
                    full_name: "Priya",
                    abandoned_signup_sent_at: null,
                  },
                }),
              }),
              in: async () => ({
                data: (input.sentIds ?? []).map((id) => ({ id, abandoned_signup_sent_at: "2026-10-22T00:00:00Z" })),
              }),
            }),
            update,
          };
        }
        if (table === "vachat_notification_logs") {
          return {
            select: () => ({
              is: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: input.log ?? null }) }),
              }),
            }),
            insert,
            update: () => ({ eq: async () => ({ error: null }) }),
            upsert,
          };
        }
        if (table === "admin_abandoned_signups") {
          return {
            select: () => ({
              not: () => ({
                order: () => ({
                  limit: async () => ({ data: input.abandoned ?? [] }),
                }),
              }),
            }),
          };
        }
        return {};
      },
    },
  };
}

describe("enqueueAbandonedSignup", () => {
  beforeEach(() => {
    h.getPlatformVachatConfig.mockReset();
    h.isPlatformVachatActive.mockReset();
    h.hasAdminClient.mockReturnValue(true);
    h.sendVachatPlatformTemplate.mockReset();
    h.sendVachatNotice.mockReset();
    h.sendVachatPlatformTemplate.mockResolvedValue({ sent: true, messageId: "m1" });
  });

  it("skips when the template is unset or platform is inactive", async () => {
    h.getPlatformVachatConfig.mockResolvedValue({ ...platform(), abandonedSignupTemplateName: "" });
    h.isPlatformVachatActive.mockReturnValue(true);
    expect(await enqueueAbandonedSignup("u1")).toEqual({ queued: false });
    expect(h.sendVachatPlatformTemplate).not.toHaveBeenCalled();
    expect(h.sendVachatNotice).not.toHaveBeenCalled();
  });

  it("skips when already sent or phone is missing", async () => {
    h.getPlatformVachatConfig.mockResolvedValue(platform());
    h.isPlatformVachatActive.mockReturnValue(true);
    const mock = supabaseMock({
      profile: { whatsapp_number: null, full_name: "A", abandoned_signup_sent_at: null },
    });
    h.createAdminClient.mockReturnValue(mock.client);
    expect(await enqueueAbandonedSignup("u1")).toEqual({ queued: false, reason: "missing_phone" });
    expect(h.sendVachatPlatformTemplate).not.toHaveBeenCalled();
  });

  it("skips confirmed accounts", async () => {
    h.getPlatformVachatConfig.mockResolvedValue(platform());
    h.isPlatformVachatActive.mockReturnValue(true);
    const mock = supabaseMock({
      user: { email_confirmed_at: "2026-10-22T00:00:00Z", phone_confirmed_at: null },
    });
    h.createAdminClient.mockReturnValue(mock.client);
    expect(await enqueueAbandonedSignup("u1")).toEqual({ queued: false, reason: "already_confirmed" });
    expect(h.sendVachatPlatformTemplate).not.toHaveBeenCalled();
  });

  it("sends the platform template without a notice job", async () => {
    h.getPlatformVachatConfig.mockResolvedValue(platform());
    h.isPlatformVachatActive.mockReturnValue(true);
    const mock = supabaseMock({});
    h.createAdminClient.mockReturnValue(mock.client);
    expect(await enqueueAbandonedSignup("u1")).toEqual({ queued: true, sent: true, messageId: "m1" });
    expect(h.sendVachatPlatformTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: "abandoned_hello",
        bodyParams: ["Priya"],
      })
    );
    expect(h.sendVachatNotice).not.toHaveBeenCalled();
    expect(mock.update).toHaveBeenCalled();
  });
});

describe("deliverAbandonedSignup", () => {
  beforeEach(() => {
    h.getPlatformVachatConfig.mockResolvedValue(platform());
    h.isPlatformVachatActive.mockReturnValue(true);
    h.sendVachatPlatformTemplate.mockReset();
    h.sendVachatNotice.mockReset();
  });

  it("skips send when already delivered", async () => {
    const mock = supabaseMock({
      profile: {
        whatsapp_number: "+919876543210",
        full_name: "Priya",
        abandoned_signup_sent_at: "2026-10-22T00:00:00Z",
      },
    });
    expect(await deliverAbandonedSignup(mock.client as never, { userId: "u1" })).toEqual({
      queued: false,
      reason: "already_sent",
    });
    expect(h.sendVachatPlatformTemplate).not.toHaveBeenCalled();
  });
});

describe("sweepAbandonedSignups", () => {
  beforeEach(() => {
    h.getPlatformVachatConfig.mockResolvedValue(platform());
    h.isPlatformVachatActive.mockReturnValue(true);
    h.sendVachatPlatformTemplate.mockReset();
    h.sendVachatNotice.mockReset();
    h.sendVachatPlatformTemplate.mockResolvedValue({ sent: true, messageId: "m1" });
  });

  it("only sends unconfirmed abandoned rows and never calls sendVachatNotice", async () => {
    const mock = supabaseMock({
      abandoned: [
        { id: "u-sent", full_name: "A", whatsapp_number: "+919876543210" },
        { id: "u-new", full_name: "B", whatsapp_number: "+919876543211" },
      ],
      sentIds: ["u-sent"],
      profile: { whatsapp_number: "+919876543211", full_name: "B", abandoned_signup_sent_at: null },
    });
    const result = await sweepAbandonedSignups(mock.client as never, 25);
    expect(result.considered).toBe(1);
    expect(result.sent).toBe(1);
    expect(h.sendVachatNotice).not.toHaveBeenCalled();
    expect(h.sendVachatPlatformTemplate).toHaveBeenCalledTimes(1);
  });
});

describe("abandonedSignupExternalRef", () => {
  it("is unique per user", () => {
    expect(abandonedSignupExternalRef("u1")).toBe("postbus:abandoned_signup:u1");
  });
});
