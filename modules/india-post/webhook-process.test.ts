import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function inboxClient(options?: {
  duplicate?: boolean;
  customerId?: string | null;
  environment?: string;
  shipment?: Record<string, unknown> | null;
  ownerConnection?: Record<string, unknown> | null;
  extraConnections?: Array<Record<string, unknown>>;
}) {
  const jobs: unknown[] = [];
  const urlConnection = {
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: orgId,
    bulk_customer_id: options?.customerId === undefined ? "1000002954" : options.customerId,
    environment: options?.environment ?? "PRODUCTION",
  };
  const ownerConnection = options?.ownerConnection ?? null;
  const shipment = options?.shipment ?? null;
  const connections = [urlConnection, ownerConnection, ...(options?.extraConnections ?? [])].filter(
    Boolean
  ) as Array<Record<string, unknown>>;
  return {
    jobs,
    rpc: async (_name: string, args: Record<string, unknown>) => {
      const connectionId = String(args.p_connection_id ?? "");
      const matched = connections.find((row) => row.id === connectionId) ?? urlConnection;
      return {
        data: {
          accepted: true,
          duplicate: Boolean(options?.duplicate),
          inbox_event_id: "inbox-1",
          organization_id: matched.organization_id,
        },
        error: null,
        args,
      };
    },
    from(table: string) {
      const state: { filters: Record<string, unknown> } = { filters: {} };
      const api: Record<string, unknown> = {};
      const result = () => {
        if (table === "india_post_connections") {
          let rows = connections;
          if (state.filters.id) rows = rows.filter((row) => row.id === state.filters.id);
          if (state.filters.organization_id) {
            rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
          }
          if (state.filters.bulk_customer_id) {
            rows = rows.filter((row) => String(row.bulk_customer_id) === String(state.filters.bulk_customer_id));
          }
          if (state.filters.environment) {
            rows = rows.filter(
              (row) => String(row.environment ?? "").toUpperCase() === String(state.filters.environment).toUpperCase()
            );
          }
          return rows;
        }
        if (table === "shipments") {
          if (!shipment) return [];
          const article = state.filters.barcode ?? state.filters.tracking_number;
          if (article && article !== shipment.barcode && article !== shipment.tracking_number) return [];
          if (state.filters.organization_id && state.filters.organization_id !== shipment.organization_id) return [];
          if (state.filters.id && state.filters.id !== shipment.id) return [];
          return [shipment];
        }
        return [];
      };
      api.select = () => api;
      api.eq = (column: string, value: unknown) => {
        state.filters[column] = value;
        return api;
      };
      api.limit = () => api;
      api.maybeSingle = async () => ({ data: result()[0] ?? null, error: null });
      api.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: result(), error: null }).then(resolve, reject);
      api.insert = (row: unknown) => {
        jobs.push(row);
        return Promise.resolve({ error: null });
      };
      return api;
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
            if (state.filters.id && state.filters.id !== shipment.id) {
              return { data: null, error: null };
            }
            if (state.filters.barcode && state.filters.barcode !== shipment.barcode) {
              return { data: null, error: null };
            }
            if (state.filters.tracking_number && state.filters.tracking_number !== shipment.tracking_number) {
              return { data: null, error: null };
            }
            if (
              state.filters.organization_id &&
              state.filters.organization_id !== shipment.organization_id
            ) {
              return { data: null, error: null };
            }
            return { data: shipment, error: null };
          }
          return { data: null, error: null };
        },
        limit() {
          return api;
        },
        then(resolve: (value: { data?: unknown; error: { code?: string; message?: string } | null }) => void) {
          if (state.patch) {
            updates.push({ table, patch: state.patch });
            if (table === "shipments") shipment = { ...shipment, ...state.patch };
            if (table === "provider_webhook_inbox") Object.assign(inbox, state.patch);
            resolve({ error: null });
            return;
          }
          if (table === "shipments") {
            const article = state.filters.barcode ?? state.filters.tracking_number;
            const articleOk = !article || article === shipment.barcode || article === shipment.tracking_number;
            const orgOk = !state.filters.organization_id || state.filters.organization_id === shipment.organization_id;
            const idOk = !state.filters.id || state.filters.id === shipment.id;
            resolve({ data: articleOk && orgOk && idOk ? [shipment] : [], error: null });
            return;
          }
          resolve({ error: null });
        },
      };
      return api;
    },
  };
}

describe("CEPT webhook accept", () => {
  beforeEach(() => {
    vi.stubEnv("INDIA_POST_WEBHOOK_ALLOWED_CIDRS", "10.0.0.0/8");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("quarantines when CIDRs are empty and does not persist or enqueue", async () => {
    vi.stubEnv("INDIA_POST_WEBHOOK_ALLOWED_CIDRS", "");
    const { createBackgroundJob } = await import("@/modules/jobs/service");
    vi.mocked(createBackgroundJob).mockClear();
    const supabase = inboxClient();
    const rpc = vi.fn(supabase.rpc);
    supabase.rpc = rpc as typeof supabase.rpc;
    const result = await acceptIndiaPostWebhook(supabase as never, {
      connectionId: "11111111-1111-4111-8111-111111111111",
      channel: "events",
      rawBody: JSON.stringify(CEPT_SAMPLE_WEBHOOK_PAYLOAD),
      contentType: "application/json",
      headers: new Headers({ "content-type": "application/json" }),
    });
    expect(result).toEqual({ accepted: false, quarantined: true, duplicate: false, inboxEventId: null });
    expect(rpc).not.toHaveBeenCalled();
    expect(createBackgroundJob).not.toHaveBeenCalled();
  });

  it("rejects a source IP outside the configured CIDRs", async () => {
    const supabase = inboxClient();
    const rpc = vi.fn(supabase.rpc);
    supabase.rpc = rpc as typeof supabase.rpc;
    await expect(
      acceptIndiaPostWebhook(supabase as never, {
        connectionId: "11111111-1111-4111-8111-111111111111",
        channel: "events",
        rawBody: JSON.stringify(CEPT_SAMPLE_WEBHOOK_PAYLOAD),
        contentType: "application/json",
        headers: new Headers({ "cf-connecting-ip": "8.8.8.8" }),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("persists a CEPT event and enqueues india-post-events", async () => {
    const { createBackgroundJob } = await import("@/modules/jobs/service");
    const supabase = inboxClient();
    const result = await acceptIndiaPostWebhook(supabase as never, {
      connectionId: "11111111-1111-4111-8111-111111111111",
      channel: "events",
      rawBody: JSON.stringify(CEPT_SAMPLE_WEBHOOK_PAYLOAD),
      contentType: "application/json",
      headers: new Headers({
        "content-type": "application/json",
        "cf-connecting-ip": "10.9.8.7",
      }),
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
      headers: new Headers({ "cf-connecting-ip": "10.9.8.7" }),
    });
    expect(result.duplicate).toBe(true);
    expect(createBackgroundJob).not.toHaveBeenCalled();
  });

  it("rejects an article owned by another organization before persistence", async () => {
    const { createBackgroundJob } = await import("@/modules/jobs/service");
    vi.mocked(createBackgroundJob).mockClear();
    const supabase = inboxClient({
      shipment: {
        id: "ship-b",
        organization_id: "org-b",
        barcode: "AW784699994IN",
        tracking_number: "AW784699994IN",
      },
      ownerConnection: {
        id: "22222222-2222-4222-8222-222222222222",
        organization_id: "org-b",
        bulk_customer_id: "1000002954",
      },
    });
    const rpc = vi.fn(supabase.rpc.bind(supabase));
    supabase.rpc = rpc as typeof supabase.rpc;
    await expect(
      acceptIndiaPostWebhook(supabase as never, {
        connectionId: "11111111-1111-4111-8111-111111111111",
        channel: "events",
        rawBody: JSON.stringify(CEPT_SAMPLE_WEBHOOK_PAYLOAD),
        contentType: "application/json",
        headers: new Headers({
          "content-type": "application/json",
          "cf-connecting-ip": "10.9.8.7",
          "x-forwarded-for": "10.9.8.7",
        }),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rpc).not.toHaveBeenCalled();
    expect(createBackgroundJob).not.toHaveBeenCalled();
  });

  it("does not follow a payload customer id onto another connection", async () => {
    const supabase = inboxClient({
      customerId: "1392911671",
      ownerConnection: {
        id: "22222222-2222-4222-8222-222222222222",
        organization_id: "org-b",
        bulk_customer_id: "1000002954",
      },
    });
    const rpc = vi.fn(supabase.rpc.bind(supabase));
    supabase.rpc = rpc as typeof supabase.rpc;
    await expect(
      acceptIndiaPostWebhook(supabase as never, {
        connectionId: "1392911671",
        channel: "events",
        rawBody: JSON.stringify(CEPT_SAMPLE_WEBHOOK_PAYLOAD),
        contentType: "application/json",
        headers: new Headers({
          "content-type": "application/json",
          "cf-connecting-ip": "10.9.8.7",
        }),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a webhook whose bulk_customer_id does not match the connection", async () => {
    await expect(
      acceptIndiaPostWebhook(inboxClient({ customerId: "999" }) as never, {
        connectionId: "11111111-1111-4111-8111-111111111111",
        channel: "events",
        rawBody: JSON.stringify(CEPT_SAMPLE_WEBHOOK_PAYLOAD),
        contentType: "application/json",
        headers: new Headers({
          "content-type": "application/json",
          "cf-connecting-ip": "10.9.8.7",
        }),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("selects the PRODUCTION connection when a UAT sibling shares the customer id", async () => {
    const { createBackgroundJob } = await import("@/modules/jobs/service");
    vi.mocked(createBackgroundJob).mockClear();
    const supabase = inboxClient({
      customerId: "1788590988",
      extraConnections: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          organization_id: "org-uat",
          bulk_customer_id: "1788590988",
          environment: "UAT",
        },
      ],
    });
    const rpc = vi.fn(supabase.rpc.bind(supabase));
    supabase.rpc = rpc as typeof supabase.rpc;
    const result = await acceptIndiaPostWebhook(supabase as never, {
      connectionId: "1788590988",
      channel: "events",
      rawBody: JSON.stringify({ ...CEPT_SAMPLE_WEBHOOK_PAYLOAD, bulk_customer_id: 1788590988 }),
      contentType: "application/json",
      headers: new Headers({
        "content-type": "application/json",
        "cf-connecting-ip": "10.9.8.7",
      }),
    });
    expect(result.accepted).toBe(true);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_connection_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("rejects a customer-id webhook when only a UAT connection exists", async () => {
    const supabase = inboxClient({
      customerId: "1788590988",
      environment: "UAT",
    });
    const rpc = vi.fn(supabase.rpc);
    supabase.rpc = rpc as typeof supabase.rpc;
    await expect(
      acceptIndiaPostWebhook(supabase as never, {
        connectionId: "1788590988",
        channel: "booking",
        rawBody: JSON.stringify({ ...CEPT_SAMPLE_WEBHOOK_PAYLOAD, bulk_customer_id: 1788590988 }),
        contentType: "application/json",
        headers: new Headers({
          "content-type": "application/json",
          "cf-connecting-ip": "10.9.8.7",
        }),
      })
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a UAT connection UUID on the production webhook route", async () => {
    const supabase = inboxClient({ environment: "UAT" });
    const rpc = vi.fn(supabase.rpc);
    supabase.rpc = rpc as typeof supabase.rpc;
    await expect(
      acceptIndiaPostWebhook(supabase as never, {
        connectionId: "11111111-1111-4111-8111-111111111111",
        channel: "events",
        rawBody: JSON.stringify(CEPT_SAMPLE_WEBHOOK_PAYLOAD),
        contentType: "application/json",
        headers: new Headers({
          "content-type": "application/json",
          "cf-connecting-ip": "10.9.8.7",
        }),
      })
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when two PRODUCTION connections share the customer id", async () => {
    const supabase = inboxClient({
      customerId: "1788590988",
      extraConnections: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          organization_id: "org-prod-b",
          bulk_customer_id: "1788590988",
          environment: "PRODUCTION",
        },
      ],
    });
    const rpc = vi.fn(supabase.rpc);
    supabase.rpc = rpc as typeof supabase.rpc;
    await expect(
      acceptIndiaPostWebhook(supabase as never, {
        connectionId: "1788590988",
        channel: "events",
        rawBody: JSON.stringify({ ...CEPT_SAMPLE_WEBHOOK_PAYLOAD, bulk_customer_id: 1788590988 }),
        contentType: "application/json",
        headers: new Headers({
          "content-type": "application/json",
          "cf-connecting-ip": "10.9.8.7",
        }),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rpc).not.toHaveBeenCalled();
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
    expect((supabase.events[0].raw as { _meta?: { source?: string } })._meta?.source).toBe("webhook");
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

  it("does not update another organization's shipment or emit side effects", async () => {
    const { enqueueTrackingStageSideEffects } = await import("@/modules/india-post/tracking-effects");
    vi.mocked(enqueueTrackingStageSideEffects).mockClear();
    const supabase = processClient({
      payload: {
        article_number: "AW784699994IN",
        event_code: "BAG_CLOSE",
        event_description: "Bag Close",
        event_date: "2025-11-09",
        event_time: "08:37:52",
      },
      shipment: {
        id: "ship-b",
        organization_id: "org-b",
        status: "BOOKED",
        barcode: "AW784699994IN",
        tracking_number: "AW784699994IN",
        order_id: "order-b",
        operational_status: "BOOKED",
        last_event_at: null,
        ndr_attempt_count: 0,
        rto_initiated_at: null,
      },
    });
    const result = await processIndiaPostInboxEvent(supabase as never, "inbox-1", orgId);
    expect(result).toEqual({ processed: false, reason: "unknown-shipment" });
    expect(supabase.events).toHaveLength(0);
    expect(supabase.shipment.status).toBe("BOOKED");
    expect(enqueueTrackingStageSideEffects).not.toHaveBeenCalled();
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
    expect(supabase.events).toHaveLength(0);
    expect(supabase.shipment.status).toBe("IN_TRANSIT");
  });

  it("rejects an unknown India Post customer id before persistence", async () => {
    vi.stubEnv("INDIA_POST_WEBHOOK_ALLOWED_CIDRS", "10.0.0.0/8");
    const supabase = inboxClient();
    const rpc = vi.fn(supabase.rpc);
    supabase.rpc = rpc as typeof supabase.rpc;
    await expect(
      acceptIndiaPostWebhook(supabase as never, {
        connectionId: "000000000001",
        channel: "booking",
        rawBody: JSON.stringify(CEPT_SAMPLE_WEBHOOK_PAYLOAD),
        contentType: "application/json",
        headers: new Headers({
          "content-type": "application/json",
          "cf-connecting-ip": "10.9.8.7",
        }),
      })
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(rpc).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("stores a hold webhook without turning it into NDR", async () => {
    const supabase = processClient({
      payload: {
        article_number: "AW784699994IN",
        event_code: "ON_HOLD",
        event_description: "Item Kept on Hold",
        event_date: "2026-10-18",
        event_time: "11:00:00",
        event_office_name: "Pandhana S.O",
      },
    });
    const result = await processIndiaPostInboxEvent(supabase as never, "inbox-1", orgId);
    expect(result).toEqual({ processed: true, shipmentId });
    expect(supabase.events[0]).toMatchObject({
      event_description: "Item Kept on Hold",
      office_name: "Pandhana S.O",
      classification: null,
    });
    expect(supabase.shipment.operational_status).toBe("IN_TRANSIT");
    expect(supabase.shipment.ndr_attempt_count).toBe(0);
  });

  it("stores a redirect webhook without turning it into RTO", async () => {
    const supabase = processClient({
      payload: {
        article_number: "AW784699994IN",
        event_code: "REDIRECTED",
        event_description: "Item Redirected",
        event_date: "2026-10-18",
        event_time: "12:00:00",
      },
    });
    const result = await processIndiaPostInboxEvent(supabase as never, "inbox-1", orgId);
    expect(result.processed).toBe(true);
    expect(supabase.events[0]).toMatchObject({
      event_description: "Item Redirected",
      classification: null,
    });
    expect(supabase.shipment.operational_status).toBe("IN_TRANSIT");
  });

  it("does not create a shipment for a booking webhook with an unknown article", async () => {
    const supabase = processClient({
      payload: {
        article_number: "ZZ000000000IN",
        event_code: "ITEM_BOOKED",
        event_description: "Item Booked",
        event_date: "2026-10-18",
        event_time: "09:00:00",
        bulk_customer_id: "1392911671",
      },
    });
    const result = await processIndiaPostInboxEvent(supabase as never, "inbox-1", orgId);
    expect(result).toEqual({ processed: false, reason: "unknown-shipment" });
    expect(supabase.events).toHaveLength(0);
    expect(supabase.updates.some((update) => update.table === "shipments" && update.patch.status)).toBe(false);
    expect(supabase.updates.some((update) => update.patch.process_status === "FAILED")).toBe(true);
  });

  it("marks a malformed inbox body failed without writing tracking history", async () => {
    const supabase = processClient({
      payload: { _unparsed: "{not-json" },
    });
    const result = await processIndiaPostInboxEvent(supabase as never, "inbox-1", orgId);
    expect(result).toEqual({ processed: false, reason: "missing-barcode" });
    expect(supabase.events).toHaveLength(0);
  });

  it("does not mutate a real shipment for a synthetic PB Test AWB", async () => {
    const { enqueueTrackingStageSideEffects } = await import("@/modules/india-post/tracking-effects");
    vi.mocked(enqueueTrackingStageSideEffects).mockClear();
    const supabase = processClient({
      payload: {
        article_number: "PB123456789IN",
        event_code: "BAG_CLOSE",
        event_description: "Bag Close",
        event_office_name: "TEST OFFICE",
        bulk_customer_id: 1788590988,
      },
    });
    const before = supabase.shipment.status;
    const result = await processIndiaPostInboxEvent(supabase as never, "inbox-1", orgId);
    expect(result).toEqual({ processed: false, reason: "unknown-shipment" });
    expect(supabase.shipment.status).toBe(before);
    expect(supabase.events).toHaveLength(0);
    expect(enqueueTrackingStageSideEffects).not.toHaveBeenCalled();
  });

  it("classifies Item Delivered(Addressee) as delivered", async () => {
    const supabase = processClient({
      payload: {
        article_number: "AW784699994IN",
        event_code: "ITEM_DELIVERED",
        event_description: "Item Delivered(Addressee)",
        event_date: "2026-10-18",
        event_time: "16:00:00",
      },
    });
    const result = await processIndiaPostInboxEvent(supabase as never, "inbox-1", orgId);
    expect(result.processed).toBe(true);
    expect(supabase.shipment.status).toBe("DELIVERED");
    expect(supabase.events[0]).toMatchObject({
      event_description: "Item Delivered(Addressee)",
    });
  });

  it("does not re-process or enqueue side effects for an already processed inbox row", async () => {
    const { enqueueTrackingStageSideEffects } = await import("@/modules/india-post/tracking-effects");
    vi.mocked(enqueueTrackingStageSideEffects).mockClear();
    const supabase = processClient({
      processStatus: "PROCESSED",
      payload: { ...CEPT_SAMPLE_WEBHOOK_PAYLOAD },
    });
    const result = await processIndiaPostInboxEvent(supabase as never, "inbox-1", orgId);
    expect(result).toEqual({ processed: false, reason: "already-processed" });
    expect(supabase.events).toHaveLength(0);
    expect(enqueueTrackingStageSideEffects).not.toHaveBeenCalled();
  });

  it("documents same-timestamp different-office collisions until the identity migration", () => {
    const occurredAt = "2026-10-18T10:30:00.000Z";
    const currentKey = (office: string) =>
      [orgId, shipmentId, "ITEM_RECEIVED", occurredAt].join("|");
    const proposedKey = (office: string) =>
      [orgId, shipmentId, "item received", occurredAt, office.toLowerCase()].join("|");
    expect(currentKey("Office A")).toBe(currentKey("Office B"));
    expect(proposedKey("Office A")).not.toBe(proposedKey("Office B"));
  });
});
