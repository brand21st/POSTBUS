import { describe, expect, it, vi } from "vitest";
import { loadIndiaPostWebhookHealth } from "@/modules/india-post/webhook-health";

function healthClient() {
  const inbox = {
    received_at: "2026-10-18T05:00:00.000Z",
    processed_at: "2026-10-18T05:01:00.000Z",
  };
  return {
    from(table: string) {
      if (table === "provider_webhook_inbox") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          order() {
            return this;
          },
          limit() {
            return this;
          },
          async maybeSingle() {
            return { data: inbox, error: null };
          },
          then(resolve: (value: { count: number; error: null }) => unknown) {
            return Promise.resolve({ count: 0, error: null }).then(resolve);
          },
        };
      }
      if (table === "background_jobs") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          gte() {
            return this;
          },
          order() {
            return this;
          },
          limit() {
            return this;
          },
          async maybeSingle() {
            return { data: null, error: null };
          },
          then(resolve: (value: { count: number; data: null; error: null }) => unknown) {
            return Promise.resolve({ count: 0, data: null, error: null }).then(resolve);
          },
        };
      }
      throw new Error(table);
    },
  };
}

describe("India Post webhook health", () => {
  it("reports quarantined ingest and does not include payload bodies", async () => {
    const health = await loadIndiaPostWebhookHealth(healthClient() as never);
    expect(health.ingestQuarantined).toBe(true);
    expect(health.senderAuthentication).toBe("none-verified");
    expect(health.productionCallbacks.eventsWebhookUrl).toBe(
      "https://www.postbus.in/api/v1/webhooks/india-post/1788590988/events"
    );
    expect(health.productionCallbacks.bookingWebhookUrl).toBe(
      "https://www.postbus.in/api/v1/webhooks/india-post/1788590988/booking"
    );
    expect(JSON.stringify(health)).not.toMatch(/article_number|password|token/i);
  });

  it("does not persist when loading health", async () => {
    const rpc = vi.fn();
    const client = { ...healthClient(), rpc };
    await loadIndiaPostWebhookHealth(client as never);
    expect(rpc).not.toHaveBeenCalled();
  });
});
