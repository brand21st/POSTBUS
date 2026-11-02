/**
 * Runs public.dispatch_booking_run on in-process Postgres (PGlite) over minimal stubs: one
 * transaction from approved queue items to existing single-article booking jobs. No hosted
 * database, no India Post call.
 *
 * Run: npx vitest run modules/booking-queue/booking-queue-dispatch.pg.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migration = (name: string) =>
  readFileSync(path.join(process.cwd(), "supabase/migrations", name), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(revoke|grant)\b/i.test(line))
    .join("\n");

let db: PGlite;
let org: string;
let otherOrg: string;

type Dispatch = {
  runId: string | null;
  replayed?: boolean;
  paused?: boolean;
  dispatched: Array<{ itemId: string; shipmentId: string; jobId: string }>;
  skipped: Array<{ itemId: string; reason: string }>;
};

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows[0];
}

/** A queue item in READY_FOR_BOOKING (set up as the system, like approval then dispatch). */
async function readyItem(organization: string, options: { shipmentStatus?: string; booked?: boolean; state?: string } = {}) {
  const order = await one<{ id: string }>("insert into public.orders (organization_id) values ($1) returning id", [organization]);
  const shipment = await one<{ id: string }>(
    "insert into public.shipments (organization_id, order_id, status) values ($1, $2, $3) returning id",
    [organization, order.id, options.shipmentStatus ?? "DRAFT"]
  );
  const item = await one<{ id: string }>(
    `insert into public.booking_queue_items (organization_id, shipment_id, order_id, source, state)
     values ($1, $2, $3, 'MANUAL', $4) returning id`,
    [organization, shipment.id, order.id, options.state ?? "READY_FOR_BOOKING"]
  );
  if (options.booked) await db.query("update public.shipments set booked_at = now() where id = $1", [shipment.id]);
  return { itemId: item.id, shipmentId: shipment.id, orderId: order.id };
}

async function dispatch(organization: string, itemIds: string[], key: string, trigger = "MANUAL") {
  const row = await one<{ result: Dispatch }>(
    "select public.dispatch_booking_run($1, $2::uuid[], $3, $4) as result",
    [organization, itemIds, key, trigger]
  );
  return row.result;
}

async function itemState(itemId: string) {
  return one<{ state: string; run_id: string | null }>("select state, run_id from public.booking_queue_items where id = $1", [itemId]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create type public.member_role as enum ('OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER');
    create type public.job_status as enum ('PENDING','QUEUED','RUNNING','RETRYING','SUCCEEDED','FAILED','CANCELLED');
    create table public.organizations (id uuid primary key default gen_random_uuid());
    create function public.is_org_member(org uuid) returns boolean language sql stable as $$ select true $$;
    create function public.has_org_role(org uuid, roles public.member_role[]) returns boolean
      language sql stable as $$ select true $$;
    create function public.set_updated_at() returns trigger language plpgsql as $$
      begin new.updated_at := now(); return new; end; $$;
    create table public.orders (id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id));
    create table public.shipments (id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id),
      order_id uuid references public.orders(id), booked_at timestamptz,
      status text not null default 'DRAFT', last_error text, last_error_code text,
      barcode text, tracking_number text, provider_ref text, metadata jsonb not null default '{}'::jsonb);
    create table public.bulk_import_rows (id uuid primary key default gen_random_uuid());
    create table public.background_jobs (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id),
      job_type text not null, entity_type text, entity_id uuid,
      status public.job_status not null default 'PENDING',
      created_by uuid, progress jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now());
    create unique index background_jobs_active_shipment_booking_uidx
      on public.background_jobs (organization_id, entity_id)
      where job_type = 'shipment-booking' and entity_type = 'shipment' and entity_id is not null
        and status in ('PENDING', 'QUEUED', 'RUNNING', 'RETRYING');
  `);
  await db.exec(migration("20261101180000_booking_queue.sql"));
  await db.exec(migration("20261101190000_booking_queue_dispatch.sql"));
  await db.exec(migration("20261101190000_booking_queue_dispatch.sql"));
  await db.exec(migration("20261103090000_dispatch_preserve_intent.sql"));
  org = (await one<{ id: string }>("insert into public.organizations default values returning id")).id;
  otherOrg = (await one<{ id: string }>("insert into public.organizations default values returning id")).id;
});

afterAll(async () => {
  await db?.close();
});

let keyCounter = 0;
let key = "";
beforeEach(() => {
  keyCounter += 1;
  key = `test-key-${keyCounter}-abcdef`;
});

describe("dispatch_booking_run", () => {
  it("turns approved items into one run with one booking job per shipment", async () => {
    const a = await readyItem(org);
    const b = await readyItem(org);
    const result = await dispatch(org, [a.itemId, b.itemId], key);
    expect(result.runId).toBeTruthy();
    expect(result.replayed).toBe(false);
    expect(result.dispatched.map((row) => row.itemId).sort()).toEqual([a.itemId, b.itemId].sort());
    expect(result.skipped).toEqual([]);

    expect(await itemState(a.itemId)).toEqual({ state: "BATCHED", run_id: result.runId });
    const shipment = await one<{ status: string }>("select status from public.shipments where id = $1", [a.shipmentId]);
    expect(shipment.status).toBe("QUEUED");
    const jobs = (
      await db.query<{ entity_id: string; status: string; progress: { bookingRunId: string } }>(
        "select entity_id, status, progress from public.background_jobs where entity_id = any($1::uuid[])",
        [[a.shipmentId, b.shipmentId]]
      )
    ).rows;
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.status === "QUEUED" && job.progress.bookingRunId === result.runId)).toBe(true);
    const run = await one<{ status: string; item_count: number; trigger: string }>(
      "select status, item_count, trigger from public.booking_runs where id = $1",
      [result.runId]
    );
    expect(run).toEqual({ status: "ACTIVE", item_count: 2, trigger: "MANUAL" });
  });

  it("TEST 8: the same confirmation key never dispatches twice", async () => {
    const a = await readyItem(org);
    const first = await dispatch(org, [a.itemId], key);
    const again = await dispatch(org, [a.itemId], key);
    expect(again).toMatchObject({ runId: first.runId, replayed: true });
    expect(again.dispatched.map((row) => row.itemId)).toEqual([a.itemId]);
    const jobs = await one<{ count: number }>("select count(*)::int as count from public.background_jobs where entity_id = $1", [a.shipmentId]);
    expect(jobs.count).toBe(1);

    // A second click with a new key finds nothing ready and creates no run.
    const second = await dispatch(org, [a.itemId], `${key}-second`);
    expect(second.runId).toBeNull();
    expect(second.skipped).toEqual([{ itemId: a.itemId, reason: "NOT_READY" }]);
    const runs = await one<{ count: number }>("select count(*)::int as count from public.booking_runs where idempotency_key = $1", [`${key}-second`]);
    expect(runs.count).toBe(0);
  });

  it("TEST 14 and 23: never dispatches booked, unapproved or invalid items", async () => {
    const booked = await readyItem(org);
    await db.query("update public.shipments set booked_at = now() where id = $1", [booked.shipmentId]);
    const waiting = await readyItem(org, { state: "WAITING_APPROVAL" });
    const invalid = await readyItem(org, { state: "INVALID" });
    const inFlight = await readyItem(org, { shipmentStatus: "BOOKING" });
    const result = await dispatch(org, [booked.itemId, waiting.itemId, invalid.itemId, inFlight.itemId], key);
    expect(result.runId).toBeNull();
    expect(Object.fromEntries(result.skipped.map((row) => [row.itemId, row.reason]))).toEqual({
      [booked.itemId]: "SHIPMENT_NOT_READY",
      [waiting.itemId]: "NOT_READY",
      [invalid.itemId]: "NOT_READY",
      [inFlight.itemId]: "SHIPMENT_NOT_READY",
    });
    expect((await itemState(invalid.itemId)).state).toBe("INVALID");
    const jobs = await one<{ count: number }>(
      "select count(*)::int as count from public.background_jobs where entity_id = any($1::uuid[])",
      [[booked.shipmentId, waiting.shipmentId, invalid.shipmentId, inFlight.shipmentId]]
    );
    expect(jobs.count).toBe(0);
  });

  it("reuses a booking job that already owns the shipment", async () => {
    const a = await readyItem(org);
    const existing = await one<{ id: string }>(
      "insert into public.background_jobs (organization_id, job_type, entity_type, entity_id, status) values ($1, 'shipment-booking', 'shipment', $2, 'RUNNING') returning id",
      [org, a.shipmentId]
    );
    const result = await dispatch(org, [a.itemId], key);
    expect(result.dispatched).toEqual([{ itemId: a.itemId, shipmentId: a.shipmentId, jobId: existing.id }]);
    const jobs = await one<{ count: number }>("select count(*)::int as count from public.background_jobs where entity_id = $1", [a.shipmentId]);
    expect(jobs.count).toBe(1);
  });

  it("TEST 16: ignores items that belong to another workspace", async () => {
    const mine = await readyItem(org);
    const theirs = await readyItem(otherOrg);
    const result = await dispatch(org, [mine.itemId, theirs.itemId], key);
    expect(result.dispatched.map((row) => row.itemId)).toEqual([mine.itemId]);
    expect(result.skipped).toEqual([{ itemId: theirs.itemId, reason: "NOT_READY" }]);
    expect((await itemState(theirs.itemId)).state).toBe("READY_FOR_BOOKING");
  });

  it("TEST 6 and 25: automatic triggers do nothing unless automation is on and not paused", async () => {
    const a = await readyItem(org);
    expect(await dispatch(org, [a.itemId], key, "AUTO_THRESHOLD")).toMatchObject({ runId: null, paused: true });
    await db.query("insert into public.booking_automation_settings (organization_id, mode, paused_at) values ($1, 'AUTOMATIC', now())", [org]);
    expect(await dispatch(org, [a.itemId], `${key}-b`, "AUTO_TIMEOUT")).toMatchObject({ runId: null, paused: true });
    await db.query("update public.booking_automation_settings set paused_at = null where organization_id = $1", [org]);
    const result = await dispatch(org, [a.itemId], `${key}-c`, "AUTO_THRESHOLD");
    expect(result.runId).toBeTruthy();
    expect((await itemState(a.itemId)).state).toBe("BATCHED");
    // Manual booking does not depend on automation settings.
    await db.query("update public.booking_automation_settings set paused_at = now() where organization_id = $1", [org]);
    const manual = await readyItem(org);
    expect((await dispatch(org, [manual.itemId], `${key}-d`)).runId).toBeTruthy();
  });

  it("refuses a missing key and unknown triggers", async () => {
    const a = await readyItem(org);
    await expect(dispatch(org, [a.itemId], "short")).rejects.toThrow(/idempotency key/);
    await expect(dispatch(org, [a.itemId], key, "WHENEVER")).rejects.toThrow(/unknown dispatch trigger/);
  });

  it("lets the system mirror a booking made elsewhere onto an item that needed fixing", async () => {
    const a = await readyItem(org, { state: "INVALID" });
    await db.query("update public.shipments set booked_at = now() where id = $1", [a.shipmentId]);
    await db.query("update public.booking_queue_items set state = 'BOOKED' where id = $1", [a.itemId]);
    expect((await itemState(a.itemId)).state).toBe("BOOKED");
  });
});

describe("dispatch_booking_run keeps booking evidence (phase 0)", () => {
  async function shipmentRow(id: string) {
    return one<{ status: string; last_error_code: string | null }>(
      "select status, last_error_code from public.shipments where id = $1",
      [id]
    );
  }

  it("does not requeue a shipment with submit intent and keeps its error code", async () => {
    const a = await readyItem(org, { shipmentStatus: "FAILED" });
    await db.query(
      `update public.shipments set barcode = 'CX467191577IN', last_error_code = 'VALIDATION_ERROR',
         metadata = jsonb_build_object('ceptSubmitIntentAt', '2026-11-01T14:47:53Z') where id = $1`,
      [a.shipmentId]
    );
    const result = await dispatch(org, [a.itemId], key);
    expect(result.dispatched).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe("SHIPMENT_NOT_READY");
    expect(await shipmentRow(a.shipmentId)).toEqual({ status: "FAILED", last_error_code: "VALIDATION_ERROR" });
  });

  it("does not requeue a barcode without a never-submitted code or creation proof", async () => {
    const a = await readyItem(org, { shipmentStatus: "FAILED" });
    await db.query("update public.shipments set barcode = 'CX1', last_error_code = 'INDIA_POST_VALIDATION' where id = $1", [
      a.shipmentId,
    ]);
    const result = await dispatch(org, [a.itemId], key);
    expect(result.dispatched).toHaveLength(0);
    expect((await shipmentRow(a.shipmentId)).status).toBe("FAILED");
  });

  it("requeues a never-sent barcode and keeps its code for the booking run", async () => {
    const a = await readyItem(org, { shipmentStatus: "FAILED" });
    await db.query("update public.shipments set barcode = 'CX2', last_error_code = 'PRE_POST_TRANSIENT' where id = $1", [
      a.shipmentId,
    ]);
    const result = await dispatch(org, [a.itemId], key);
    expect(result.dispatched).toHaveLength(1);
    expect(await shipmentRow(a.shipmentId)).toEqual({ status: "QUEUED", last_error_code: "PRE_POST_TRANSIENT" });
  });

  it("requeues a barcode written with a creation proof (bulk Excel)", async () => {
    const a = await readyItem(org, { shipmentStatus: "DRAFT" });
    await db.query(
      `update public.shipments set barcode = 'CX3', metadata = jsonb_build_object('bookingBarcodeProof', jsonb_build_object('v', 1))
        where id = $1`,
      [a.shipmentId]
    );
    const result = await dispatch(org, [a.itemId], key);
    expect(result.dispatched).toHaveLength(1);
    expect((await shipmentRow(a.shipmentId)).status).toBe("QUEUED");
  });

  it("still clears the error on a plain failed shipment", async () => {
    const a = await readyItem(org, { shipmentStatus: "FAILED" });
    await db.query("update public.shipments set last_error_code = 'VALIDATION_ERROR' where id = $1", [a.shipmentId]);
    const result = await dispatch(org, [a.itemId], key);
    expect(result.dispatched).toHaveLength(1);
    expect(await shipmentRow(a.shipmentId)).toEqual({ status: "QUEUED", last_error_code: null });
  });
});
