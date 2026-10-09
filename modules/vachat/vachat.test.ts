import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyVachatSignature } from "@/modules/vachat/signature";
import { isDuplicateVachatNotifyJob, vachatExternalRef, vachatRecipientE164 } from "@/modules/vachat/send";
import {
  acceptVachatWebhook,
  claimVachatInboundEnvelope,
  inboundWebhookEnvelopeId,
  vachatWebhookNotification,
} from "@/modules/vachat/webhook";

const assistant = vi.hoisted(() => ({
  isInboundAssistantEvent: vi.fn(),
  resolveInboundSender: vi.fn(),
  handleVachatAssistantMessage: vi.fn(),
}));

vi.mock("@/modules/vachat/assistant", () => ({
  isInboundAssistantEvent: (...args: unknown[]) => assistant.isInboundAssistantEvent(...args),
  resolveInboundSender: (...args: unknown[]) => assistant.resolveInboundSender(...args),
  handleVachatAssistantMessage: (...args: unknown[]) => assistant.handleVachatAssistantMessage(...args),
}));

const platform = vi.hoisted(() => ({
  getPlatformVachatConfig: vi.fn(),
  isPlatformVachatActive: vi.fn(),
}));

vi.mock("@/modules/vachat/platform-config", () => ({
  getPlatformVachatConfig: (...args: unknown[]) => platform.getPlatformVachatConfig(...args),
  isPlatformVachatActive: (...args: unknown[]) => platform.isPlatformVachatActive(...args),
  merchantVachatRowReady: () => false,
}));

const supportIdentify = vi.hoisted(() => ({
  identifyGlobalInbound: vi.fn(async () => ({ kind: "unassigned" as const })),
  quarantineInbound: vi.fn(async () => undefined),
}));

vi.mock("@/modules/support/identify", () => ({
  identifyGlobalInbound: (...args: unknown[]) => supportIdentify.identifyGlobalInbound(...args),
  quarantineInbound: (...args: unknown[]) => supportIdentify.quarantineInbound(...args),
}));

const supportIngest = vi.hoisted(() => ({
  maybeRouteInboundToSupport: vi.fn(async () => ({ routed: true })),
}));

vi.mock("@/modules/support/ingest", () => ({
  maybeRouteInboundToSupport: (...args: unknown[]) => supportIngest.maybeRouteInboundToSupport(...args),
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
    supportIdentify.identifyGlobalInbound.mockReset();
    supportIdentify.identifyGlobalInbound.mockResolvedValue({ kind: "unassigned" });
    supportIdentify.quarantineInbound.mockReset();
    supportIdentify.quarantineInbound.mockResolvedValue(undefined);
    supportIngest.maybeRouteInboundToSupport.mockReset();
    supportIngest.maybeRouteInboundToSupport.mockResolvedValue({ routed: true });
    assistant.handleVachatAssistantMessage.mockReset();
    assistant.isInboundAssistantEvent.mockReset();
    assistant.resolveInboundSender.mockReset();
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

  it("records inbound envelopes even when organizationId is null and skips duplicate command execution", async () => {
    const secret = "whsec_platform";
    const body = JSON.stringify({
      id: "evt-inbound-1",
      event: "message.received",
      data: { from: "918848772371", text: "YES PB-11143" },
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
    assistant.isInboundAssistantEvent.mockReturnValue(true);
    assistant.resolveInboundSender.mockResolvedValue({ from: "918848772371", text: "YES PB-11143", contactId: "" });
    assistant.handleVachatAssistantMessage.mockResolvedValue({
      handled: true,
      reply: "confirmed",
      organizationId: null,
    });
    const envelopes = new Set<string>();
    const supabase = {
      from: (table: string) => {
        if (table === "vachat_webhook_envelopes") {
          return {
            select: () => ({
              eq: (_column: string, value: string) => ({
                maybeSingle: async () => ({ data: envelopes.has(value) ? { envelope_id: value } : null }),
              }),
            }),
            insert: async (row: { envelope_id: string }) => {
              if (envelopes.has(row.envelope_id)) return { error: { code: "23505" } };
              envelopes.add(row.envelope_id);
              return { error: null };
            },
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      },
    };
    const first = await acceptVachatWebhook(supabase as never, {
      rawBody: body,
      signatureHeader: `t=${t},v1=${v1}`,
    });
    const second = await acceptVachatWebhook(supabase as never, {
      rawBody: body,
      signatureHeader: `t=${t},v1=${v1}`,
    });
    expect(first).toMatchObject({ accepted: true, duplicate: false, assistant: true });
    expect(second).toMatchObject({ accepted: true, duplicate: true, assistant: true });
    expect(assistant.handleVachatAssistantMessage).toHaveBeenCalledTimes(1);
    expect(supportIdentify.quarantineInbound).toHaveBeenCalledTimes(1);
  });

  it("skips the platform assistant when inbound is uniquely assigned to a merchant inbox", async () => {
    const secret = "whsec_platform";
    const body = JSON.stringify({
      id: "evt-assigned-1",
      event: "message.received",
      data: { from: "918848772371", text: "PB-11143" },
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
    assistant.isInboundAssistantEvent.mockReturnValue(true);
    assistant.resolveInboundSender.mockResolvedValue({ from: "918848772371", text: "PB-11143", contactId: "" });
    supportIdentify.identifyGlobalInbound.mockResolvedValue({
      kind: "assigned",
      organizationId: "org-1",
      orderId: "ord-1",
    });
    const supabase = {
      from: (table: string) => {
        if (table === "vachat_webhook_envelopes") {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
            insert: async () => ({ error: null }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      },
    };
    const result = await acceptVachatWebhook(supabase as never, {
      rawBody: body,
      signatureHeader: `t=${t},v1=${v1}`,
    });
    expect(result).toEqual({ accepted: true, duplicate: false, support: true });
    expect(supportIngest.maybeRouteInboundToSupport).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      expect.anything(),
      body,
      "postbus_global",
      "ord-1"
    );
    expect(assistant.handleVachatAssistantMessage).not.toHaveBeenCalled();
  });

  it("accepts a merchant HMAC while platform shipping VaChat is active", async () => {
    const { encryptSecret } = await import("@/lib/security/crypto");
    const platformSecret = "whsec_platform";
    const merchantSecret = "whsec_merchant";
    const body = JSON.stringify({
      id: "evt-merchant-1",
      event: "message.status_updated",
      data: { status: "delivered", merchant_id: "org-m" },
    });
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", merchantSecret).update(`${t}.${body}`).digest("hex");
    platform.isPlatformVachatActive.mockReturnValue(true);
    platform.getPlatformVachatConfig.mockResolvedValue({
      enabled: true,
      flagEnabled: true,
      apiKey: "key",
      webhookSecret: platformSecret,
      apiBaseUrl: "https://cloud.vachat.in",
    });
    const encrypted = encryptSecret(merchantSecret);
    const supabase = {
      from: (table: string) => {
        if (table === "vachat_connections") {
          return {
            select: () => ({
              not: async () => ({
                data: [
                  {
                    id: "conn-m",
                    organization_id: "org-m",
                    webhook_secret_encrypted: encrypted,
                    status: "CONNECTED",
                  },
                ],
                error: null,
              }),
            }),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === "idempotency_keys") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: null }) }),
              }),
            }),
            insert: async () => ({ error: null }),
          };
        }
        if (table === "notifications") {
          return { insert: async () => ({ error: null }) };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      },
    };
    const result = await acceptVachatWebhook(supabase as never, {
      rawBody: body,
      signatureHeader: `t=${t},v1=${v1}`,
    });
    expect(result).toEqual({ accepted: true, duplicate: false });
    expect(assistant.handleVachatAssistantMessage).not.toHaveBeenCalled();
  });
});

describe("inbound webhook envelope identity", () => {
  it("falls back to a body hash when organizationId and envelope id are missing", () => {
    const id = inboundWebhookEnvelopeId({ data: {} }, '{"text":"YES PB-11143"}');
    expect(id.startsWith("body:")).toBe(true);
  });

  it("treats a second insert of the same envelope as a duplicate without an organization", async () => {
    const seen = new Set<string>();
    const supabase = {
      from: () => ({
        select: () => ({
          eq: (_column: string, value: string) => ({
            maybeSingle: async () => ({ data: seen.has(value) ? { envelope_id: value } : null }),
          }),
        }),
        insert: async (row: { envelope_id: string }) => {
          if (seen.has(row.envelope_id)) return { error: { code: "23505" } };
          seen.add(row.envelope_id);
          return { error: null };
        },
      }),
    };
    const first = await claimVachatInboundEnvelope(supabase as never, "evt-null-org", "hash");
    const second = await claimVachatInboundEnvelope(supabase as never, "evt-null-org", "hash");
    expect(first).toEqual({ duplicate: false });
    expect(second).toEqual({ duplicate: true });
  });
});

