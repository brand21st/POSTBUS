import { describe, expect, it, vi } from "vitest";
import { CEPT_SAMPLE_WEBHOOK_PAYLOAD } from "@/modules/india-post/webhook-parser";
import { acceptIndiaPostWebhook, processIndiaPostInboxEvent } from "@/modules/india-post/webhook";

vi.mock("@/modules/jobs/service", () => ({
  createBackgroundJob: vi.fn(async () => ({ id: "job-1" })),
}));

vi.mock("@/modules/webhooks/outgoing", () => ({
  emitWebhook: vi.fn(async () => undefined),
}));

vi.mock("@/modules/india-post/tracking-effects", () => ({
  enqueueTrackingStageSideEffects: vi.fn(async () => undefined),
}));

const orgId = "org-a";
const shipmentId = "ship-a";

function inboxClient(options?: { duplicate?: boolean }) {
  const jobs: unknown[] = [];
  return {
    jobs,
    rpc: async (_name: string, args: Record<string, unknown>) => ({
      data: {
        accepted: true,
        duplicate: Boolean(options?.duplicate),
        inbox_event_id: "inbox-1",
        organization_id: orgId,
      },
      error: null,
      args,
    }),
    from() {
      return {
        insert(row: unknown) {
          jobs.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

function processClient(input: {
  processStatus?: string;
  payload: Record<string, unknown>;
  shipment?: Record<string, unknown> | null;
}) {
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const events: Record<string, unknown>[] = [];
  let shipment = input.shipment
    ? { ...input.shipment }
    : {
        id: shipmentId,
        organization_id: orgId,
        status: "IN_TRANSIT",
        barcode: "AW784699994IN",
        tracking_number: "AW784699994IN",
        order_id: "order-a",
        operational_status: "IN_TRANSIT",
        last_event_at: "2026-09-01T00:00:00.000Z",
        ndr_attempt_count: 0,
        rto_initiated_at: null,
      };

  const inbox = {
    id: "inbox-1",
    organization_id: orgId,
    channel: "events",
    process_status: input.processStatus ?? "PENDING",
    raw_payload: input.payload,
    received_at: "2026-09-27T10:15:00.000Z",
  };

  return {
    updates,
    events,
    get shipment() {
      return shipment;
    },
    from(table: string) {
      const state: { patch?: Record<string, unknown>; filters: Record<string, unknown> } = { filters: {} };
      const api = {
        select() {
          return api;
        },
        insert(row: Record<string, unknown>) {
          if (table === "tracking_events") {
            const key = `${row.shipment_id}|${row.event_code}|${row.occurred_at}`;
            const duplicate = events.some(
              (event) => `${event.shipment_id}|${event.event_code}|${event.occurred_at}` === key
            );
            if (duplicate) return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
            events.push(row);
          }
          return Promise.resolve({ error: null });
        },
        update(patch: Record<string, unknown>) {
          state.patch = patch;
          return api;
        },
        eq(column: string, value: unknown) {
          state.filters[column] = value;
          return api;
        },
        maybeSingle: async () => {
          if (table === "provider_webhook_inbox") return { data: inbox, error: null };
          if (table === "shipments") {
            if (state.filters.barcode && state.filters.barcode !== shipment.barcode) {
              return { data: null, error: null };
            }
            if (state.filters.tracking_number && state.filters.tracking_number !== shipment.tracking_number) {
              return { data: null, error: null };
            }
            if (state.filters.organization_id && state.filters.organization_id !== orgId) {
              return { data: null, error: null };
            }
            return { data: shipment, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve: (value: { error: null }) => void) {
          if (state.patch) {
            updates.push({ table, patch: state.patch });
            if (table === "shipments") shipment = { ...shipment, ...state.patch };
            if (table === "provider_webhook_inbox") Object.assign(inbox, state.patch);
          }
          resolve({ error: null });
        },
      };
      return api;
    },
  };
}

describe("CEPT webhook accept", () => {
  it("persists a CEPT event and enqueues india-post-events", async () => {
    const { createBackgroundJob } = await import("@/modules/jobs/service");
    const supabase = inboxClient();
    const result = await acceptIndiaPostWebhook(supabase as never, {
      connectionId: "11111111-1111-4111-8111-111111111111",
      channel: "events",
      rawBody: JSON.stringify(CEPT_SAMPLE_WEBHOOK_PAYLOAD),
      contentType: "application/json",
      headers: new Headers({ "content-type": "application/json" }),
    });
    expect(result).toEqual({ accepted: true, duplicate: false, inboxEventId: "inbox-1" });
    expect(createBackgroundJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: orgId,
        jobType: "india-post-events",
        entityId: "inbox-1",
      })
    );
  });

  it("does not enqueue a duplicate CEPT payload", async () => {
    const { createBackgroundJob } = await import("@/modules/jobs/service");
    vi.mocked(createBackgroundJob).mockClear();
    const result = await acceptIndiaPostWebhook(inboxClient({ duplicate: true }) as never, {
      connectionId: "11111111-1111-4111-8111-111111111111",
      channel: "events",
      rawBody: JSON.stringify(CEPT_SAMPLE_WEBHOOK_PAYLOAD),
      contentType: "application/json",
      headers: new Headers(),
    });
    expect(result.duplicate).toBe(true);
    expect(createBackgroundJob).not.toHaveBeenCalled();
  });
});

describe("CEPT webhook process", () => {
  it("applies an NDR CEPT event onto the matching tenant shipment", async () => {
    const supabase = processClient({
      payload: {
        article_number: "AW784699994IN",
        event_code: "DELIVERY_ATTEMPTED",
        event_description: "Delivery attempted",
        event_date: "2026-09-27",
        event_time: "10:15:00",
        event_office_name: "Pandhana S.O",
        non_delivery_reason: "Addressee cannot be located",
      },
    });
    const result = await processIndiaPostInboxEvent(supabase as never, "inbox-1", orgId);
    expect(result).toEqual({ processed: true, shipmentId });
    expect(supabase.shipment.status).toBe("NDR");
    expect(supabase.shipment.operational_status).toBe("NDR");
    expect(supabase.shipment.ndr_reason).toBe("Addressee cannot be located");
    expect(supabase.events[0]).toMatchObject({ classification: "NDR", event_code: "DELIVERY_ATTEMPTED" });
    expect(supabase.updates.some((update) => update.table === "provider_webhook_inbox" && update.patch.process_status === "PROCESSED")).toBe(
      true
    );
  });

  it("applies the official BAG_CLOSE sample as in transit", async () => {
    const supabase = processClient({
      payload: { ...CEPT_SAMPLE_WEBHOOK_PAYLOAD },
      shipment: {
        id: shipmentId,
        organization_id: orgId,
        status: "BOOKED",
        barcode: "AW784699994IN",
        tracking_number: "AW784699994IN",
        order_id: "order-a",
        operational_status: "BOOKED",
        last_event_at: null,
        ndr_attempt_count: 0,
        rto_initiated_at: null,
      },
    });
    const result = await processIndiaPostInboxEvent(supabase as never, "inbox-1", orgId);
    expect(result.processed).toBe(true);
    expect(supabase.shipment.status).toBe("IN_TRANSIT");
    expect(supabase.shipment.last_event_code).toBe("BAG_CLOSE");
  });

  it("fails closed when the article does not belong to the tenant", async () => {
    const supabase = processClient({
      payload: {
        article_number: "ET000000015IN",
        event_code: "ITEM_DELIVERED",
        event_date: "2026-09-27",
        event_time: "11:00:00",
      },
    });
    const result = await processIndiaPostInboxEvent(supabase as never, "inbox-1", orgId);
    expect(result).toEqual({ processed: false, reason: "unknown-shipment" });
  });
});
