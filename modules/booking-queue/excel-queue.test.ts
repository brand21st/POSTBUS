import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const startBookingForShipmentIds = vi.fn();
const createManualOrder = vi.fn();
const allocateNextBarcode = vi.fn();

vi.mock("@/modules/india-post/bulk-booking", () => ({
  startBookingForShipmentIds: (...args: unknown[]) => startBookingForShipmentIds(...args),
  countsFromShipments: () => ({}),
}));
vi.mock("@/modules/orders/service", () => ({ createManualOrder: (...args: unknown[]) => createManualOrder(...args) }));
vi.mock("@/modules/india-post/allocate-barcode", () => ({ allocateNextBarcode: (...args: unknown[]) => allocateNextBarcode(...args) }));
vi.mock("@/modules/jobs/service", () => ({ createBackgroundJob: vi.fn(async () => ({ id: "job-next" })) }));

const { materializeBulkExcelImport } = await import("@/modules/india-post/bulk-excel-import");

type Row = Record<string, unknown>;

function readPath(row: Row, column: string) {
  const json = /^(\w+)->>(\w+)$/.exec(column);
  if (json) {
    const value = (row[json[1]] as Row | undefined)?.[json[2]];
    return value == null ? null : String(value);
  }
  return row[column];
}

function memoryDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  let ids = 0;
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | null = null;
    const rows = () => (tables[table] ??= []);
    const run = () => {
      if (op === "insert") {
        const row: Row = { id: `${table}-${++ids}`, ...payload! };
        if (table === "booking_queue_items" && rows().some((other) => other.import_row_id && other.import_row_id === row.import_row_id)) {
          return { data: null, error: { code: "23505", message: "duplicate key booking_queue_items_import_row_uidx" } };
        }
        rows().push(row);
        return { data: [row], error: null };
      }
      const matched = rows().filter((row) => filters.every((test) => test(row)));
      if (op === "update") for (const row of matched) Object.assign(row, payload);
      return { data: matched, error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (value: Row) => ((op = "insert"), (payload = value), builder),
      update: (value: Row) => ((op = "update"), (payload = value), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => readPath(row, column) === value), builder),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
      or: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => {
        const result = run();
        return { data: result.data?.[0] ?? null, error: result.error };
      },
      single: async () => {
        const result = run();
        return { data: result.data?.[0] ?? null, error: result.error };
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  };
  return { tables, client: { from } as unknown as SupabaseClient };
}

function seed() {
  const row = (id: string, number: number, reference: string) => ({
    id,
    batch_id: "batch-1",
    organization_id: "org-1",
    excel_row_number: number,
    raw_cells: {},
    mapped_fields: {},
    unmapped: {},
    normalized: {
      receiverName: "Asha",
      receiverPhone: "9876543210",
      line1: "12 MG Road",
      city: "Kochi",
      state: "Kerala",
      pincode: "682001",
      weightGrams: 500,
      paymentMode: "PREPAID",
      bulkReference: reference,
    },
    issues: [],
    barcode: null,
    status: "valid",
    order_id: null,
    shipment_id: null,
  });
  return memoryDb({
    bulk_import_batches: [
      { id: "batch-1", organization_id: "org-1", status: "booking", service_code: "SP_INLAND_PARCEL", created_by: "user-1", materialize_job_id: null },
    ],
    bulk_import_rows: [row("row-1", 2, "#1"), row("row-2", 3, "#2")],
    orders: [],
    shipments: [],
    booking_queue_items: [],
    india_post_connections: [],
  });
}

const ORIGINAL_FLAG = process.env.BOOKING_QUEUE_ORGS;
let orderCount = 0;
let serial = 0;

beforeEach(() => {
  startBookingForShipmentIds.mockReset();
  orderCount = 0;
  serial = 0;
  allocateNextBarcode.mockImplementation(async () => `EA${String(++serial).padStart(9, "0")}IN`);
});

afterEach(() => {
  process.env.BOOKING_QUEUE_ORGS = ORIGINAL_FLAG;
});

function wireOrders(db: ReturnType<typeof memoryDb>) {
  createManualOrder.mockImplementation(async (_s: unknown, _c: unknown, input: { metadata?: Row; orderNumber?: string }) => {
    const order = {
      id: `order-${++orderCount}`,
      organization_id: "org-1",
      customer_id: "cust",
      shipping_address_id: "addr",
      order_number: input.orderNumber,
      metadata: input.metadata ?? {},
    };
    db.tables.orders.push(order);
    return order;
  });
}

describe("Excel import with the Bulk Booking queue on", () => {
  it("adds valid rows to the queue for approval and books nothing", async () => {
    process.env.BOOKING_QUEUE_ORGS = "org-1";
    const db = seed();
    wireOrders(db);
    await materializeBulkExcelImport(db.client, "org-1", "batch-1", "job-1");
    expect(startBookingForShipmentIds).not.toHaveBeenCalled();
    expect(db.tables.shipments.map((row) => row.status)).toEqual(["DRAFT", "DRAFT"]);
    expect(db.tables.booking_queue_items).toEqual([
      expect.objectContaining({ source: "EXCEL", state: "WAITING_APPROVAL", import_row_id: "row-1", enrolled_via: "EXCEL", enrolled_by: "user-1" }),
      expect.objectContaining({ source: "EXCEL", state: "WAITING_APPROVAL", import_row_id: "row-2" }),
    ]);
    expect(db.tables.booking_queue_items[0].shipment_id).toBe(db.tables.shipments[0].id);
    expect(db.tables.bulk_import_batches[0].status).toBe("completed");
  });

  it("TEST 9 (part): a resumed import does not add a second queue item for the same row", async () => {
    process.env.BOOKING_QUEUE_ORGS = "org-1";
    const db = seed();
    wireOrders(db);
    db.tables.booking_queue_items.push({ id: "existing", import_row_id: "row-1", organization_id: "org-1", state: "WAITING_APPROVAL" });
    await materializeBulkExcelImport(db.client, "org-1", "batch-1", "job-1");
    expect(db.tables.booking_queue_items.filter((row) => row.import_row_id === "row-1")).toHaveLength(1);
    expect(db.tables.bulk_import_rows.every((row) => row.status === "queued")).toBe(true);
  });

  it("keeps booking straight away for workspaces outside the rollout", async () => {
    process.env.BOOKING_QUEUE_ORGS = "";
    const db = seed();
    wireOrders(db);
    await materializeBulkExcelImport(db.client, "org-1", "batch-1", "job-1");
    expect(db.tables.shipments.map((row) => row.status)).toEqual(["QUEUED", "QUEUED"]);
    expect(db.tables.booking_queue_items).toEqual([]);
    expect(startBookingForShipmentIds).toHaveBeenCalledTimes(1);
  });
});
