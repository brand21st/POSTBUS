import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/security/crypto";
import { memorySupabase } from "@/modules/autopack/memory-supabase.testkit";
import type { WooRemoteOrder } from "@/modules/woocommerce/map-order";
import { wooWebhookSignature } from "@/modules/woocommerce/signature";

const woo = vi.hoisted(() => ({
  orders: new Map<string, WooRemoteOrder>(),
  getWooOrder: vi.fn(),
  listWooOrders: vi.fn(),
  autoSync: true,
  logError: vi.fn(),
}));

vi.mock("@/modules/woocommerce/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/woocommerce/client")>()),
  getWooOrder: woo.getWooOrder,
  listWooOrders: woo.listWooOrders,
  getWooProduct: vi.fn(async () => ({})),
  getWooVariation: vi.fn(async () => ({})),
}));

vi.mock("@/modules/automation/service", () => ({
  isAutoWooCommerceSyncEnabled: vi.fn(async () => woo.autoSync),
  getAutomationSettings: vi.fn(async () => ({ autoShipmentCreation: false, autoBooking: false })),
}));

vi.mock("@/modules/shipments/service", () => ({ createShipmentsForOrders: vi.fn(async () => []) }));

vi.mock("@/lib/logger", () => ({ logError: woo.logError, logInfo: vi.fn() }));

vi.mock("@/modules/jobs/service", async () => {
  const { testUuid } = await import("@/modules/autopack/memory-supabase.testkit");
  return {
    createBackgroundJob: vi.fn(
      async (
        supabase: { from: (table: string) => { insert: (row: unknown) => { select: () => { single: () => unknown } } } },
        input: { organizationId: string; jobType: string; entityType?: string; entityId?: string; progress?: unknown }
      ) => {
        const { data } = (await supabase
          .from("background_jobs")
          .insert({
            id: testUuid(),
            organization_id: input.organizationId,
            job_type: input.jobType,
            entity_type: input.entityType ?? null,
            entity_id: input.entityId ?? null,
            status: "QUEUED",
            progress: input.progress ?? {},
          })
          .select()
          .single()) as { data: unknown };
        return data;
      }
    ),
  };
});

import { upsertWooCommerceOrder, syncWooCommercePage, type WooConnectionRow } from "@/modules/woocommerce/orders";
import { enqueueDueWooCommerceSyncJobs, enqueueWooCommerceSync } from "@/modules/woocommerce/sync-job";
import { acceptWooWebhook, isWooWebhookPing, processWooWebhookJob, wooDeliveryKey } from "@/modules/woocommerce/webhooks";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONNECTION = "22222222-2222-4222-8222-222222222222";
const SECRET = "whsec_test_value";

function remoteOrder(id: number, patch: Partial<WooRemoteOrder> = {}): WooRemoteOrder {
  return {
    id,
    number: String(id),
    status: "processing",
    currency: "INR",
    date_created: "2026-10-31T10:00:00",
    date_modified: "2026-10-31T10:00:00",
    payment_method: "cod",
    payment_method_title: "Cash on delivery",
    total: "590.00",
    shipping_total: "40",
    billing: { first_name: "Asha", last_name: "Nair", phone: "9876543210", address_1: "12 Beach Road", city: "Kochi", state: "KL", postcode: "682001" },
    shipping: { first_name: "Asha", last_name: "Nair", phone: "9876543210", address_1: "12 Beach Road", city: "Kochi", state: "KL", postcode: "682001" },
    line_items: [{ name: "Cotton saree", product_id: 9, quantity: 1, sku: "SAR-1", total: "550" }],
    ...patch,
  };
}

function connectionRow(patch: Partial<WooConnectionRow> = {}): WooConnectionRow {
  return {
    id: CONNECTION,
    organization_id: ORG,
    store_url: "https://shop.example",
    store_host: "shop.example",
    encrypted_consumer_key: encryptSecret("ck_test"),
    encrypted_consumer_secret: encryptSecret("cs_test"),
    encrypted_webhook_secret: encryptSecret(SECRET),
    status: "CONNECTED",
    sync_enabled: true,
    settings: { eligibleStatuses: ["processing", "on-hold"], importDays: 30 },
    ...patch,
  };
}

function db(connection: Partial<WooConnectionRow> = {}) {
  return memorySupabase(
    { woocommerce_connections: [connectionRow(connection) as never] },
    {
      unique: {
        external_order_references: [["organization_id", "source", "source_order_id"]],
        orders: [["organization_id", "order_number"]],
        idempotency_keys: [["organization_id", "key"]],
      },
    }
  );
}

function upsert(supabase: unknown, remote: WooRemoteOrder) {
  return upsertWooCommerceOrder(supabase as never, {
    organizationId: ORG,
    storeHost: "shop.example",
    remote,
    eligibleStatuses: ["processing", "on-hold"],
  });
}

beforeEach(() => {
  woo.orders.clear();
  woo.autoSync = true;
  woo.logError.mockReset();
  woo.getWooOrder.mockReset();
  woo.getWooOrder.mockImplementation(async (_creds: unknown, id: string) => {
    const order = woo.orders.get(id);
    if (!order) throw new Error(`order ${id} not found`);
    return order;
  });
  woo.listWooOrders.mockReset();
});

describe("upsertWooCommerceOrder idempotency", () => {
  it("imports a new order once and updates it on the next delivery", async () => {
    const mem = db();
    const first = await upsert(mem.client, remoteOrder(501));
    expect(first.created).toBe(true);
    const second = await upsert(mem.client, remoteOrder(501, { total: "640.00" }));
    expect(second).toMatchObject({ created: false, updated: true, orderId: first.orderId });
    expect(mem.rows("orders")).toHaveLength(1);
    expect(mem.rows("external_order_references")).toHaveLength(1);
    expect(mem.rows("orders")[0]).toMatchObject({ total_amount: 640 });
  });

  it("keeps one order when order.created and order.updated import concurrently", async () => {
    const mem = db();
    const results = await Promise.all([upsert(mem.client, remoteOrder(777)), upsert(mem.client, remoteOrder(777))]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(mem.rows("orders")).toHaveLength(1);
    expect(mem.rows("external_order_references")).toHaveLength(1);
    expect(mem.rows("external_order_references")[0].order_id).toBe(mem.rows("orders")[0].id);
    // Both workers got as far as creating a customer; the loser removed its draft rows.
    expect(mem.calls.filter((call) => call.table === "customers" && call.op === "insert")).toHaveLength(2);
    expect(mem.rows("customers")).toHaveLength(1);
    expect(mem.rows("addresses")).toHaveLength(2);
  });

  it("skips pending orders until they reach an eligible status", async () => {
    const mem = db();
    expect((await upsert(mem.client, remoteOrder(9, { status: "pending" }))).skipped).toBe(true);
    expect(mem.rows("orders")).toHaveLength(0);
    expect((await upsert(mem.client, remoteOrder(9))).created).toBe(true);
  });
});

describe("WooCommerce webhook delivery", () => {
  function deliver(mem: ReturnType<typeof db>, body: string, headers: { topic?: string; delivery?: string | null; signature?: string | null } = {}) {
    return acceptWooWebhook(mem.client, {
      connectionId: CONNECTION,
      rawBody: body,
      signature: headers.signature === undefined ? wooWebhookSignature(SECRET, body) : headers.signature,
      topic: headers.topic ?? "order.created",
      deliveryId: headers.delivery === undefined ? "same-second-hash" : headers.delivery,
    });
  }

  it("rejects a bad signature", async () => {
    const mem = db();
    await expect(deliver(mem, JSON.stringify({ id: 1 }), { signature: "bad" })).rejects.toThrow(/signature/i);
    expect(mem.rows("woocommerce_webhook_deliveries")).toHaveLength(0);
  });

  it("acknowledges the unsigned creation ping without queuing work", async () => {
    const mem = db();
    expect(isWooWebhookPing("webhook_id=42")).toBe(true);
    await expect(deliver(mem, "webhook_id=42", { signature: null, topic: "" })).resolves.toMatchObject({ ignored: true });
    expect(mem.rows("background_jobs")).toHaveLength(0);
  });

  it("queues different orders that share WooCommerce's per-second delivery id", async () => {
    const mem = db();
    const a = await deliver(mem, JSON.stringify({ id: 11 }), { topic: "order.updated" });
    const b = await deliver(mem, JSON.stringify({ id: 12 }), { topic: "order.updated" });
    expect(a).toMatchObject({ queued: true });
    expect(b).toMatchObject({ queued: true });
    expect(mem.rows("background_jobs")).toHaveLength(2);
    expect(wooDeliveryKey("x", "a")).not.toBe(wooDeliveryKey("x", "b"));
  });

  it("drops an exact redelivery of the same payload", async () => {
    const mem = db();
    const body = JSON.stringify({ id: 11 });
    await deliver(mem, body);
    await expect(deliver(mem, body)).resolves.toMatchObject({ duplicate: true });
    expect(mem.rows("background_jobs")).toHaveLength(1);
  });

  it("imports the order end to end from a queued webhook job", async () => {
    const mem = db();
    woo.orders.set("31", remoteOrder(31));
    await deliver(mem, JSON.stringify({ id: 31 }));
    const job = mem.rows("background_jobs")[0] as { entity_type: string; progress: Record<string, string> };
    expect(job.entity_type).toBe("woocommerce_webhook");
    await processWooWebhookJob(mem.client, {
      organizationId: ORG,
      connectionId: CONNECTION,
      topic: job.progress.topic,
      orderId: job.progress.orderId,
      deliveryId: job.progress.deliveryId,
    });
    expect(mem.rows("orders")).toHaveLength(1);
    expect(mem.rows("orders")[0]).toMatchObject({ source: "WOOCOMMERCE", source_order_id: "31" });
    expect(mem.rows("woocommerce_webhook_deliveries")[0]).toMatchObject({ status: "PROCESSED" });
  });

  it("marks the delivery FAILED, logs, and rethrows so the job retries", async () => {
    const mem = db();
    await deliver(mem, JSON.stringify({ id: 404 }));
    const deliveryId = String(mem.rows("woocommerce_webhook_deliveries")[0].id);
    await expect(
      processWooWebhookJob(mem.client, { organizationId: ORG, connectionId: CONNECTION, topic: "order.created", orderId: "404", deliveryId })
    ).rejects.toThrow(/not found/);
    expect(mem.rows("woocommerce_webhook_deliveries")[0]).toMatchObject({ status: "FAILED", last_error: "order 404 not found" });
    expect(woo.logError).toHaveBeenCalledWith("woocommerce.webhook_import_failed", expect.objectContaining({ orderId: "404" }));
  });

  it("ignores deliveries while automatic WooCommerce sync is off", async () => {
    const mem = db();
    woo.autoSync = false;
    woo.orders.set("5", remoteOrder(5));
    const result = await processWooWebhookJob(mem.client, { organizationId: ORG, connectionId: CONNECTION, topic: "order.created", orderId: "5" });
    expect(result).toMatchObject({ skipped: true, reason: "auto_sync_off" });
    expect(mem.rows("orders")).toHaveLength(0);
  });
});

describe("WooCommerce polling fallback", () => {
  it("a queued webhook job does not block a store sync", async () => {
    const mem = db();
    mem.rows("background_jobs").push({ id: "job-webhook", organization_id: ORG, job_type: "woocommerce-sync", entity_type: "woocommerce_webhook", status: "QUEUED" });
    const result = await enqueueWooCommerceSync(mem.client, { organizationId: ORG, force: true });
    expect(result).toMatchObject({ queued: true, duplicate: false });
  });

  it("enqueues an incremental sync for stores not synced recently, once", async () => {
    const now = new Date("2026-11-01T12:00:00Z");
    const mem = db({ last_sync_at: "2026-11-01T11:00:00Z" });
    expect(await enqueueDueWooCommerceSyncJobs(mem.client, { now })).toEqual({ checked: 1, queued: 1 });
    const job = mem.rows("background_jobs")[0] as { entity_type: string; progress: { force: boolean } };
    expect(job).toMatchObject({ entity_type: "woocommerce_connection", progress: { force: false } });
    // The next cron tick sees the active job and does not pile up another one.
    expect(await enqueueDueWooCommerceSyncJobs(mem.client, { now })).toEqual({ checked: 1, queued: 0 });
  });

  it("skips stores synced within the interval, disabled stores, and the auto-sync flag off", async () => {
    const now = new Date("2026-11-01T12:00:00Z");
    expect(await enqueueDueWooCommerceSyncJobs(db({ last_sync_at: "2026-11-01T11:58:00Z" }).client, { now })).toEqual({ checked: 0, queued: 0 });
    expect(await enqueueDueWooCommerceSyncJobs(db({ sync_enabled: false }).client, { now })).toEqual({ checked: 0, queued: 0 });
    woo.autoSync = false;
    expect(await enqueueDueWooCommerceSyncJobs(db().client, { now })).toEqual({ checked: 1, queued: 0 });
  });

  it("pulls orders modified since the last successful sync and imports new ones", async () => {
    const mem = db({ last_successful_sync_at: "2026-11-01T11:00:00.000Z" });
    woo.listWooOrders.mockResolvedValue({ orders: [remoteOrder(61), remoteOrder(62, { status: "pending" })], totalPages: 1 });
    const connection = mem.rows("woocommerce_connections")[0] as WooConnectionRow;
    const result = await syncWooCommercePage(mem.client, {
      connection,
      credentials: { storeUrl: "https://shop.example", consumerKey: "ck", consumerSecret: "cs" },
      force: false,
    });
    expect(woo.listWooOrders.mock.calls[0][1]).toMatchObject({ modified_after: "2026-11-01T10:58:00.000Z" });
    expect(result).toMatchObject({ imported: 1, skipped: 1, hasMore: false });
    expect(mem.rows("orders").map((row) => row.source_order_id)).toEqual(["61"]);
  });
});
