/**
 * Applies the Bulk Booking queue migration to in-process Postgres (PGlite) over minimal stubs
 * and checks the state machine, tenant guard and enrollment rules. No hosted database is touched.
 *
 * Run: npx vitest run modules/booking-queue/booking-queue-migration.pg.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { BOOKING_QUEUE_STATES, canTransitionQueueItem, MEMBER_SETTABLE_STATES } from "@/modules/booking-queue/state";

const migration = (name: string) =>
  readFileSync(path.join(process.cwd(), "supabase/migrations", name), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(revoke|grant)\b/i.test(line))
    .join("\n");

let db: PGlite;
let orgA: string;
let orgB: string;
const MEMBER = "11111111-1111-1111-1111-111111111111";

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows[0];
}

/** Run as a signed-in member (auth.uid() set) or as service-role code (auth.uid() null). */
async function as(actor: "member" | "system") {
  await db.exec(`select set_config('test.uid', '${actor === "member" ? MEMBER : ""}', false)`);
}

async function shipment(org: string, booked = false) {
  const order = await one<{ id: string }>("insert into public.orders (organization_id) values ($1) returning id", [org]);
  const ship = await one<{ id: string }>(
    "insert into public.shipments (organization_id, order_id, booked_at) values ($1, $2, $3) returning id",
    [org, order.id, booked ? new Date().toISOString() : null]
  );
  return { orderId: order.id, shipmentId: ship.id };
}

async function enqueue(org: string, ids: { orderId: string; shipmentId: string }, state = "PENDING_VALIDATION") {
  return one<{ id: string; state: string; ready_at: string | null }>(
    `insert into public.booking_queue_items (organization_id, shipment_id, order_id, source, state)
     values ($1, $2, $3, 'MANUAL', $4) returning id, state, ready_at`,
    [org, ids.shipmentId, ids.orderId, state]
  );
}

async function move(id: string, state: string) {
  return one<{ state: string; ready_at: string | null }>(
    "update public.booking_queue_items set state = $2 where id = $1 returning state, ready_at",
    [id, state]
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid $$;
    create type public.member_role as enum ('OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER');
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
      order_id uuid references public.orders(id), booked_at timestamptz);
    create table public.bulk_import_rows (id uuid primary key default gen_random_uuid());
  `);
  await db.exec(migration("20261101180000_booking_queue.sql"));
  await db.exec(migration("20261101190000_booking_queue_dispatch.sql"));
  // Deploy retries re-run migrations.
  await db.exec(migration("20261101180000_booking_queue.sql"));
  await db.exec(migration("20261101190000_booking_queue_dispatch.sql"));
  orgA = (await one<{ id: string }>("insert into public.organizations default values returning id")).id;
  orgB = (await one<{ id: string }>("insert into public.organizations default values returning id")).id;
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await as("member");
});

describe("booking queue migration", () => {
  it("has the same transition matrix as modules/booking-queue/state.ts", async () => {
    for (const from of BOOKING_QUEUE_STATES) {
      for (const to of BOOKING_QUEUE_STATES) {
        if (from === to) continue;
        const row = await one<{ ok: boolean }>("select public.booking_queue_transition_allowed($1, $2) as ok", [from, to]);
        expect(row.ok, `${from} -> ${to}`).toBe(canTransitionQueueItem(from, to));
      }
    }
    for (const state of BOOKING_QUEUE_STATES) {
      const row = await one<{ ok: boolean }>("select public.booking_queue_member_state($1) as ok", [state]);
      expect(row.ok, state).toBe(MEMBER_SETTABLE_STATES.has(state));
    }
  });

  it("lets a member enroll a shipment only in PENDING_VALIDATION and logs it", async () => {
    const ids = await shipment(orgA);
    const item = await enqueue(orgA, ids);
    expect(item.state).toBe("PENDING_VALIDATION");
    expect(item.ready_at).toBeNull();
    const events = (await db.query("select from_state, to_state, actor_id from public.booking_queue_events where item_id = $1", [item.id])).rows;
    expect(events).toEqual([{ from_state: null, to_state: "PENDING_VALIDATION", actor_id: MEMBER }]);

    const other = await shipment(orgA);
    await expect(enqueue(orgA, other, "READY_FOR_BOOKING")).rejects.toThrow(/start in PENDING_VALIDATION/);
  });

  it("allows one live item per shipment", async () => {
    const ids = await shipment(orgA);
    const first = await enqueue(orgA, ids);
    await expect(enqueue(orgA, ids)).rejects.toThrow(/booking_queue_items_one_active_uidx|duplicate key/);
    await move(first.id, "EXCLUDED");
    const again = await enqueue(orgA, ids);
    expect(again.state).toBe("PENDING_VALIDATION");
  });

  it("refuses a shipment that India Post already booked", async () => {
    const ids = await shipment(orgA, true);
    await expect(enqueue(orgA, ids)).rejects.toThrow(/already booked/);
  });

  it("refuses items whose shipment or order belongs to another workspace", async () => {
    const ids = await shipment(orgB);
    await expect(enqueue(orgA, ids)).rejects.toThrow(/organization/);
    const mine = await shipment(orgA);
    await expect(enqueue(orgA, { orderId: ids.orderId, shipmentId: mine.shipmentId })).rejects.toThrow(/organization/);
  });

  it("starts the waiting clock on READY and keeps it when a run is released before posting", async () => {
    const ids = await shipment(orgA);
    const item = await enqueue(orgA, ids);
    await move(item.id, "WAITING_APPROVAL");
    const ready = await move(item.id, "READY_FOR_BOOKING");
    expect(ready.ready_at).not.toBeNull();

    // Members cannot batch; the system can.
    await expect(move(item.id, "BATCHED")).rejects.toThrow(/system-only/);
    await as("system");
    const batched = await move(item.id, "BATCHED");
    expect(batched.ready_at).toEqual(ready.ready_at);
    const released = await move(item.id, "READY_FOR_BOOKING");
    expect(released.ready_at).toEqual(ready.ready_at);

    // A member cannot forge the clock.
    await as("member");
    const forged = await one<{ ready_at: string }>(
      "update public.booking_queue_items set ready_at = now() - interval '2 days' where id = $1 returning ready_at",
      [item.id]
    );
    expect(forged.ready_at).toEqual(ready.ready_at);
  });

  it("rejects illegal transitions for everyone", async () => {
    const ids = await shipment(orgA);
    const item = await enqueue(orgA, ids);
    await move(item.id, "INVALID");
    await expect(move(item.id, "READY_FOR_BOOKING")).rejects.toThrow(/illegal booking queue transition/);
    await as("system");
    await expect(move(item.id, "SUBMITTING")).rejects.toThrow(/illegal booking queue transition/);
  });

  it("only mirrors BOOKED from a shipment India Post confirmed", async () => {
    const ids = await shipment(orgA);
    const item = await enqueue(orgA, ids);
    await as("system");
    await expect(move(item.id, "BOOKED")).rejects.toThrow(/confirmed by India Post/);
    await db.query("update public.shipments set booked_at = now() where id = $1", [ids.shipmentId]);
    expect((await move(item.id, "BOOKED")).state).toBe("BOOKED");
    await expect(move(item.id, "FAILED")).rejects.toThrow(/illegal/);
    // A member can never set BOOKED, even when the shipment is booked.
    const other = await shipment(orgA);
    await as("member");
    const second = await enqueue(orgA, other);
    await db.query("update public.shipments set booked_at = now() where id = $1", [other.shipmentId]);
    await expect(move(second.id, "BOOKED")).rejects.toThrow(/system-only/);
  });

  it("keeps identity and run assignment out of members' hands", async () => {
    const ids = await shipment(orgA);
    const item = await enqueue(orgA, ids);
    const other = await shipment(orgA);
    await expect(
      db.query("update public.booking_queue_items set shipment_id = $2 where id = $1", [item.id, other.shipmentId])
    ).rejects.toThrow(/immutable/);
    const run = await one<{ id: string }>(
      "insert into public.booking_runs (organization_id, trigger, idempotency_key, group_key) values ($1, 'MANUAL', 'k1', 'g') returning id",
      [orgA]
    );
    await expect(db.query("update public.booking_queue_items set run_id = $2 where id = $1", [item.id, run.id])).rejects.toThrow(
      /only the system/
    );
  });

  it("makes manual mode the default and validates settings", async () => {
    const row = await one<{ mode: string; batch_threshold: number; max_wait_minutes: number | null; enrollment_sources: string[] }>(
      "insert into public.booking_automation_settings (organization_id) values ($1) returning *",
      [orgA]
    );
    expect(row).toMatchObject({ mode: "MANUAL", batch_threshold: 50, max_wait_minutes: null, enrollment_sources: [] });
    await expect(
      db.query("update public.booking_automation_settings set batch_threshold = 5001 where organization_id = $1", [orgA])
    ).rejects.toThrow();
    await expect(
      db.query("update public.booking_automation_settings set enrollment_sources = '{SHOPIFY,FAX}' where organization_id = $1", [orgA])
    ).rejects.toThrow(/booking_automation_sources_check/);
  });

  it("de-duplicates runs by idempotency key per workspace", async () => {
    const insert = (org: string) =>
      db.query("insert into public.booking_runs (organization_id, trigger, idempotency_key, group_key) values ($1, 'MANUAL', 'same', 'g')", [org]);
    await insert(orgA);
    await expect(insert(orgA)).rejects.toThrow(/duplicate key/);
    await insert(orgB);
  });
});
