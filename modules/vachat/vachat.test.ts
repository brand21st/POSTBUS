import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyVachatSignature } from "@/modules/vachat/signature";
import { isDuplicateVachatNotifyJob, vachatExternalRef, vachatRecipientE164 } from "@/modules/vachat/send";
import { acceptVachatWebhook, vachatWebhookNotification } from "@/modules/vachat/webhook";

const platform = vi.hoisted(() => ({
  getPlatformVachatConfig: vi.fn(),
  isPlatformVachatActive: vi.fn(),
}));

vi.mock("@/modules/vachat/platform-config", () => ({
  getPlatformVachatConfig: (...args: unknown[]) => platform.getPlatformVachatConfig(...args),
  isPlatformVachatActive: (...args: unknown[]) => platform.isPlatformVachatActive(...args),
}));

describe("verifyVachatSignature", () => {
  it("accepts a fresh t=/v1= HMAC and rejects a stale timestamp", () => {
    const secret = "whsec_test";
    const body = '{"id":"evt-1"}';
    const t = 1_700_000_000;
    const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    expect(verifyVachatSignature(`t=${t},v1=${v1}`, body, secret, t)).toBe(true);
    expect(verifyVachatSignature(`t=${t},v1=${v1}`, body, secret, t + 400)).toBe(false);
  });
});

describe("vachat enqueue dedupe", () => {
  it("treats an open job for the same event and shipment as a duplicate", () => {
    expect(
      isDuplicateVachatNotifyJob(
        [{ entity_id: "ship-1", progress: { event: "booked", shipmentId: "ship-1" } }],
        "booked",
        { shipmentId: "ship-1" }
      )
    ).toBe(true);
    expect(
      isDuplicateVachatNotifyJob(
        [{ entity_id: "ship-1", progress: { event: "delivered", shipmentId: "ship-1" } }],
        "booked",
        { shipmentId: "ship-1" }
      )
    ).toBe(false);
  });

  it("builds a stable external_ref", () => {
    expect(vachatExternalRef("booked", { shipmentId: "s1" })).toBe("postbus:booked:s1");
  });

  it("normalizes the default automation test number to E.164", () => {
    expect(vachatRecipientE164("918618456029")).toBe("+918618456029");
    expect(vachatRecipientE164("8618456029")).toBe("+918618456029");
    expect(() => vachatRecipientE164(null)).toThrow(/TEST WhatsApp number/);
  });
});

describe("vachatWebhookNotification", () => {
  it("maps read as an additive type", () => {
    expect(vachatWebhookNotification("read").type).toBe("vachat.message_read");
    expect(vachatWebhookNotification("delivered").type).toBe("vachat.message_delivered");
  });
});

describe("acceptVachatWebhook platform routing", () => {
  beforeEach(() => {
    platform.getPlatformVachatConfig.mockReset();
    platform.isPlatformVachatActive.mockReset();
  });

  it("routes a signed platform webhook by merchant_id", async () => {
    const secret = "whsec_platform";
    const body = JSON.stringify({
      id: "evt-9",
      event: "message.status_updated",
      data: { status: "delivered", merchant_id: "org-1", external_ref: "postbus:booked:s1" },
    });
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    platform.isPlatformVachatActive.mockReturnValue(true);
    platform.getPlatformVachatConfig.mockResolvedValue({
      enabled: true,
      flagEnabled: true,
      apiKey: "key",
      webhookSecret: secret,
      apiBaseUrl: "https://cloud.vachat.in",
    });
    const inserts: unknown[] = [];
    const supabase = {
      from: (table: string) => {
        if (table === "organizations") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { id: "org-1" } }) }),
            }),
          };
        }
        if (table === "idempotency_keys") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: null }) }),
              }),
            }),
            insert: async (row: unknown) => {
              inserts.push(row);
              return { error: null };
            },
          };
        }
        if (table === "notifications") {
          return { insert: async () => ({ error: null }) };
        }
        if (table === "vachat_notification_logs") {
          return {
            update: () => ({
              eq: () => ({
                eq: async () => ({ error: null }),
              }),
            }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      },
    };
    const result = await acceptVachatWebhook(supabase as never, {
      rawBody: body,
      signatureHeader: `t=${t},v1=${v1}`,
    });
    expect(result).toEqual({ accepted: true, duplicate: false });
    expect(inserts[0]).toMatchObject({ organization_id: "org-1" });
  });

  it("rejects an unknown merchant_id in platform mode", async () => {
    const secret = "whsec_platform";
    const body = JSON.stringify({
      id: "evt-10",
      data: { status: "sent", merchant_id: "missing" },
    });
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    platform.isPlatformVachatActive.mockReturnValue(true);
    platform.getPlatformVachatConfig.mockResolvedValue({
      enabled: true,
      flagEnabled: true,
      apiKey: "key",
      webhookSecret: secret,
      apiBaseUrl: "https://cloud.vachat.in",
    });
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null }) }),
        }),
      }),
    };
    await expect(
      acceptVachatWebhook(supabase as never, {
        rawBody: body,
        signatureHeader: `t=${t},v1=${v1}`,
      })
    ).rejects.toThrow(/Unknown PostBus merchant/);
  });
});
