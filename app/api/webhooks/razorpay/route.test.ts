import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const processRazorpayEvent = vi.fn();

type EventRow = {
  id: string;
  event_id: string;
  status: string;
  processing_lease: string | null;
  processing_until: number | null;
  attempts: number;
};

const events: EventRow[] = [];
let leaseCounter = 0;

/** In-memory stand-in for razorpay_webhook_events plus claim_razorpay_webhook_event. */
const supabase = {
  async rpc(name: string, args: { p_event_id: string }) {
    if (name !== "claim_razorpay_webhook_event") return { data: null, error: { message: "unexpected rpc" } };
    const row = events.find((item) => item.event_id === args.p_event_id);
    if (!row) return { data: { state: "missing" }, error: null };
    if (row.status === "processed" || row.status === "ignored") return { data: { state: "complete" }, error: null };
    if (row.processing_until && row.processing_until > Date.now()) return { data: { state: "busy" }, error: null };
    leaseCounter += 1;
    Object.assign(row, {
      status: "received",
      processing_lease: `lease-${leaseCounter}`,
      processing_until: Date.now() + 300_000,
      attempts: row.attempts + 1,
    });
    return { data: { state: "claimed", id: row.id, lease: row.processing_lease }, error: null };
  },
  from() {
    return {
      insert(value: { event_id: string }) {
        return {
          select: () => ({
            maybeSingle: async () => {
              if (events.some((item) => item.event_id === value.event_id)) {
                return { data: null, error: { code: "23505", message: "duplicate key" } };
              }
              const row: EventRow = {
                id: `row-${events.length + 1}`,
                event_id: value.event_id,
                status: "received",
                processing_lease: null,
                processing_until: null,
                attempts: 0,
              };
              events.push(row);
              return { data: { id: row.id }, error: null };
            },
          }),
        };
      },
      update(patch: Partial<EventRow>) {
        const filters: Record<string, unknown> = {};
        const chain = {
          eq(column: string, value: unknown) {
            filters[column] = value;
            return chain;
          },
          then(resolve: (value: unknown) => void) {
            const row = events.find(
              (item) =>
                item.id === filters.id &&
                (filters.processing_lease === undefined || item.processing_lease === filters.processing_lease)
            );
            if (row) Object.assign(row, patch);
            resolve({ error: null });
          },
        };
        return chain;
      },
    };
  },
};

vi.mock("@/lib/supabase/admin", () => ({
  hasAdminClient: () => true,
  createAdminClient: () => supabase,
}));
vi.mock("@/modules/razorpay/config", () => ({ getRazorpayWebhookSecret: async () => "whsec" }));
vi.mock("@/modules/razorpay/signature", () => ({ verifyWebhookSignature: () => true }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));
vi.mock("@/modules/billing/webhooks", () => ({
  isUniqueViolation: (error: { code?: string } | null) => error?.code === "23505",
  razorpayWebhookEventId: (header: string) => header,
  processRazorpayEvent: (...args: unknown[]) => processRazorpayEvent(...args),
}));

import { POST } from "@/app/api/webhooks/razorpay/route";

function deliver(eventId = "evt_capture") {
  return POST(
    new NextRequest("http://127.0.0.1:3000/api/webhooks/razorpay", {
      method: "POST",
      headers: { "x-razorpay-signature": "sig", "x-razorpay-event-id": eventId },
      body: JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1" } } } }),
    })
  );
}

describe("POST /api/webhooks/razorpay retry handling (F-07)", () => {
  beforeEach(() => {
    events.length = 0;
    processRazorpayEvent.mockReset();
  });

  it("reprocesses Razorpay's retry after a failed first attempt, then treats later deliveries as duplicates", async () => {
    processRazorpayEvent.mockRejectedValueOnce(new Error("temporary database error"));
    processRazorpayEvent.mockResolvedValue({ processed: true });

    const first = await deliver();
    expect(first.status).toBe(500);
    expect(events[0]).toMatchObject({ status: "failed", processing_until: null });

    const retry = await deliver();
    expect(retry.status).toBe(200);
    expect(events[0]).toMatchObject({ status: "processed", attempts: 2 });

    const late = await deliver();
    expect(await late.json()).toMatchObject({ duplicate: true });
    expect(processRazorpayEvent).toHaveBeenCalledTimes(2);
  });

  it("does not let a concurrent delivery process an event that holds a live lease", async () => {
    events.push({
      id: "row-busy",
      event_id: "evt_busy",
      status: "received",
      processing_lease: "lease-x",
      processing_until: Date.now() + 60_000,
      attempts: 1,
    });
    const response = await deliver("evt_busy");
    expect(response.status).toBe(409);
    expect(processRazorpayEvent).not.toHaveBeenCalled();
  });
});
