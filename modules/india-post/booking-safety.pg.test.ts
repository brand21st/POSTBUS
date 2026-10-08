/**
 * Real PostgreSQL concurrency proof for India Post booking lock + active job uniqueness.
 * Uses in-process PGlite (Postgres), not a mock RPC.
 *
 * Run: npx vitest run modules/india-post/booking-safety.pg.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { withIndiaPostBookingLock } from "@/modules/india-post/booking-lock";

const lockSql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261008020000_india_post_booking_lock.sql"),
  "utf8"
);
const jobSql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261008031000_india_post_active_booking_job.sql"),
  "utf8"
);

let db: PGlite;
let orgA: string;
let orgB: string;
let shipmentA: string;

function withoutGrants(sql: string) {
  return sql
    .split("\n")
    .filter((line) => !/^\s*(revoke|grant)\b/i.test(line))
    .join("\n");
}

function pgliteRpc() {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      try {
        if (name === "acquire_india_post_booking_lock") {
          const result = await db.query<{ acquire_india_post_booking_lock: string | null }>(
            "select public.acquire_india_post_booking_lock($1::uuid, $2::int) as acquire_india_post_booking_lock",
            [args.p_organization_id, args.p_ttl_seconds ?? 45]
          );
          return { data: result.rows[0]?.acquire_india_post_booking_lock ?? null, error: null };
        }
        if (name === "release_india_post_booking_lock") {
          await db.query("select public.release_india_post_booking_lock($1::uuid, $2::uuid)", [
            args.p_organization_id,
            args.p_token,
          ]);
          return { data: null, error: null };
        }
        if (name === "enqueue_shipment_booking_job") {
          const result = await db.query(
            `select * from public.enqueue_shipment_booking_job($1::uuid, $2::uuid, $3::uuid, $4::jsonb)`,
            [args.p_organization_id, args.p_entity_id, args.p_user_id ?? null, args.p_progress ?? {}]
          );
          return { data: result.rows[0] ?? null, error: null };
        }
        return { data: null, error: { message: `unknown rpc ${name}` } };
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : "rpc failed" } };
      }
    },
  };
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    do $$ begin
      create type public.job_status as enum ('PENDING','QUEUED','RUNNING','RETRYING','SUCCEEDED','FAILED','CANCELLED');
    exception when duplicate_object then null;
    end $$;
    do $$ begin
      create type public.integration_status as enum ('NOT_CONNECTED','PENDING','CONNECTED','ERROR','DISCONNECTED');
    exception when duplicate_object then null;
    end $$;
    create table public.organizations (
      id uuid primary key default gen_random_uuid(),
      name text not null default 'org'
    );
    create table public.india_post_connections (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null unique,
      status public.integration_status not null default 'CONNECTED'
    );
    create table public.background_jobs (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      job_type text not null,
      entity_type text,
      entity_id uuid,
      status public.job_status not null default 'PENDING',
      attempt_count integer not null default 0,
      max_attempts integer not null default 5,
      next_attempt_at timestamptz,
      locked_at timestamptz,
      started_at timestamptz,
      completed_at timestamptz,
      last_error text,
      last_error_code text,
      progress jsonb not null default '{}'::jsonb,
      created_by uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  await db.exec(withoutGrants(lockSql));
  await db.exec(withoutGrants(jobSql));
  const orgs = await db.query<{ id: string }>(
    "insert into public.organizations (name) values ('A'), ('B') returning id"
  );
  orgA = orgs.rows[0]!.id;
  orgB = orgs.rows[1]!.id;
  await db.query("insert into public.india_post_connections (organization_id) values ($1), ($2)", [orgA, orgB]);
  shipmentA = (await db.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
});

afterAll(async () => {
  await db?.close();
});

describe("H1 real PostgreSQL booking lock", () => {
  it("allows only one concurrent acquire for the same organization", async () => {
    const [first, second] = await Promise.all([
      db.query<{ acquire_india_post_booking_lock: string | null }>(
        "select public.acquire_india_post_booking_lock($1::uuid, 45) as acquire_india_post_booking_lock",
        [orgA]
      ),
      db.query<{ acquire_india_post_booking_lock: string | null }>(
        "select public.acquire_india_post_booking_lock($1::uuid, 45) as acquire_india_post_booking_lock",
        [orgA]
      ),
    ]);
    const tokens = [
      first.rows[0]?.acquire_india_post_booking_lock,
      second.rows[0]?.acquire_india_post_booking_lock,
    ];
    expect(tokens.filter(Boolean)).toHaveLength(1);
    expect(tokens.filter((token) => token == null)).toHaveLength(1);
    const owner = tokens.find(Boolean)!;
    await db.query("select public.release_india_post_booking_lock($1::uuid, $2::uuid)", [orgA, owner]);
    const again = await db.query<{ acquire_india_post_booking_lock: string | null }>(
      "select public.acquire_india_post_booking_lock($1::uuid, 45) as acquire_india_post_booking_lock",
      [orgA]
    );
    expect(again.rows[0]?.acquire_india_post_booking_lock).toBeTruthy();
    await db.query("select public.release_india_post_booking_lock($1::uuid, $2::uuid)", [
      orgA,
      again.rows[0]!.acquire_india_post_booking_lock,
    ]);
  });

  it("lets different organizations hold locks independently", async () => {
    const [a, b] = await Promise.all([
      db.query<{ acquire_india_post_booking_lock: string | null }>(
        "select public.acquire_india_post_booking_lock($1::uuid, 45) as acquire_india_post_booking_lock",
        [orgA]
      ),
      db.query<{ acquire_india_post_booking_lock: string | null }>(
        "select public.acquire_india_post_booking_lock($1::uuid, 45) as acquire_india_post_booking_lock",
        [orgB]
      ),
    ]);
    expect(a.rows[0]?.acquire_india_post_booking_lock).toBeTruthy();
    expect(b.rows[0]?.acquire_india_post_booking_lock).toBeTruthy();
    await db.query("select public.release_india_post_booking_lock($1::uuid, $2::uuid)", [
      orgA,
      a.rows[0]!.acquire_india_post_booking_lock,
    ]);
    await db.query("select public.release_india_post_booking_lock($1::uuid, $2::uuid)", [
      orgB,
      b.rows[0]!.acquire_india_post_booking_lock,
    ]);
  });

  it("ignores a stale token release after ownership changes", async () => {
    const first = await db.query<{ acquire_india_post_booking_lock: string | null }>(
      "select public.acquire_india_post_booking_lock($1::uuid, 45) as acquire_india_post_booking_lock",
      [orgA]
    );
    const tokenA = first.rows[0]!.acquire_india_post_booking_lock!;
    await db.query("update public.india_post_connections set booking_lock_expires_at = now() - interval '1 second' where organization_id = $1", [
      orgA,
    ]);
    const second = await db.query<{ acquire_india_post_booking_lock: string | null }>(
      "select public.acquire_india_post_booking_lock($1::uuid, 45) as acquire_india_post_booking_lock",
      [orgA]
    );
    const tokenB = second.rows[0]!.acquire_india_post_booking_lock!;
    expect(tokenB).toBeTruthy();
    expect(tokenB).not.toBe(tokenA);
    await db.query("select public.release_india_post_booking_lock($1::uuid, $2::uuid)", [orgA, tokenA]);
    const still = await db.query<{ booking_lock_token: string }>(
      "select booking_lock_token from public.india_post_connections where organization_id = $1",
      [orgA]
    );
    expect(still.rows[0]?.booking_lock_token).toBe(tokenB);
    await db.query("select public.release_india_post_booking_lock($1::uuid, $2::uuid)", [orgA, tokenB]);
  });

  it("lets a later worker acquire an expired lease", async () => {
    const first = await db.query<{ acquire_india_post_booking_lock: string | null }>(
      "select public.acquire_india_post_booking_lock($1::uuid, 45) as acquire_india_post_booking_lock",
      [orgA]
    );
    expect(first.rows[0]?.acquire_india_post_booking_lock).toBeTruthy();
    await db.query("update public.india_post_connections set booking_lock_expires_at = now() - interval '1 second' where organization_id = $1", [
      orgA,
    ]);
    const stolen = await db.query<{ acquire_india_post_booking_lock: string | null }>(
      "select public.acquire_india_post_booking_lock($1::uuid, 45) as acquire_india_post_booking_lock",
      [orgA]
    );
    expect(stolen.rows[0]?.acquire_india_post_booking_lock).toBeTruthy();
    await db.query("select public.release_india_post_booking_lock($1::uuid, $2::uuid)", [
      orgA,
      stolen.rows[0]!.acquire_india_post_booking_lock,
    ]);
  });

  it("serializes CEPT-critical work across skipProcessLock workers using the DB lease", async () => {
    const supabase = pgliteRpc();
    let inFlight = 0;
    let max = 0;
    await Promise.all([
      withIndiaPostBookingLock(supabase as never, { organizationId: orgA, skipProcessLock: true }, async () => {
        inFlight += 1;
        max = Math.max(max, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 40));
        inFlight -= 1;
      }),
      withIndiaPostBookingLock(supabase as never, { organizationId: orgA, skipProcessLock: true }, async () => {
        inFlight += 1;
        max = Math.max(max, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
      }),
    ]);
    expect(max).toBe(1);
  });
});

describe("H3 real PostgreSQL active booking job uniqueness", () => {
  it("rejects a second active booking job for the same shipment", async () => {
    await db.query(
      `insert into public.background_jobs (organization_id, job_type, entity_type, entity_id, status)
       values ($1, 'shipment-booking', 'shipment', $2, 'QUEUED')`,
      [orgA, shipmentA]
    );
    const second = await db.query(
      `insert into public.background_jobs (organization_id, job_type, entity_type, entity_id, status)
       values ($1, 'shipment-booking', 'shipment', $2, 'QUEUED')`,
      [orgA, shipmentA]
    ).then(
      () => ({ ok: true as const }),
      (error: { message?: string; code?: string }) => ({ ok: false as const, error })
    );
    expect(second.ok).toBe(false);
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from public.background_jobs
        where organization_id = $1 and entity_id = $2
          and status in ('PENDING','QUEUED','RUNNING','RETRYING')`,
      [orgA, shipmentA]
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it("allows a historical FAILED job plus one new active job", async () => {
    const shipmentB = (await db.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
    await db.query(
      `insert into public.background_jobs (organization_id, job_type, entity_type, entity_id, status)
       values ($1, 'shipment-booking', 'shipment', $2, 'FAILED')`,
      [orgA, shipmentB]
    );
    await db.query(
      `insert into public.background_jobs (organization_id, job_type, entity_type, entity_id, status)
       values ($1, 'shipment-booking', 'shipment', $2, 'QUEUED')`,
      [orgA, shipmentB]
    );
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from public.background_jobs where entity_id = $1`,
      [shipmentB]
    );
    expect(count.rows[0]?.n).toBe(2);
  });

  it("returns the existing active job from concurrent enqueue RPC calls", async () => {
    const shipmentC = (await db.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
    const [a, b] = await Promise.all([
      db.query<{ id: string }>(
        "select id from public.enqueue_shipment_booking_job($1::uuid, $2::uuid, null, '{}'::jsonb)",
        [orgA, shipmentC]
      ),
      db.query<{ id: string }>(
        "select id from public.enqueue_shipment_booking_job($1::uuid, $2::uuid, null, '{}'::jsonb)",
        [orgA, shipmentC]
      ),
    ]);
    expect(a.rows[0]?.id).toBeTruthy();
    expect(b.rows[0]?.id).toBe(a.rows[0]?.id);
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from public.background_jobs
        where entity_id = $1 and status in ('PENDING','QUEUED','RUNNING','RETRYING')`,
      [shipmentC]
    );
    expect(count.rows[0]?.n).toBe(1);
  });
});
