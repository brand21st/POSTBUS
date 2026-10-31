/**
 * Isolated Postgres proof that claim_background_jobs does not pick 2099 holds,
 * and that stale RUNNING recovery would reclaim a leaked RUNNING parked job.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { HISTORICAL_JOB_HOLD_AT } from "@/modules/india-post/smart-auto-retry";

let db: PGlite;
let orgId: string;
let shipmentQueued: string;
let shipmentRetrying: string;
let shipmentStale: string;
let shipmentDue: string;

function withoutGrants(sql: string) {
  return sql
    .split("\n")
    .filter((line) => !/^\s*(revoke|grant)\b/i.test(line))
    .join("\n");
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    do $$ begin
      create type public.job_status as enum ('PENDING','QUEUED','RUNNING','RETRYING','SUCCEEDED','FAILED','CANCELLED');
    exception when duplicate_object then null;
    end $$;
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
      created_at timestamptz not null default now()
    );
  `);
  await db.exec(
    withoutGrants(
      readFileSync(path.join(process.cwd(), "supabase/migrations/20261006140000_claim_background_jobs_types.sql"), "utf8")
    )
  );
  orgId = (await db.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
  shipmentQueued = (await db.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
  shipmentRetrying = (await db.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
  shipmentStale = (await db.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
  shipmentDue = (await db.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
  await db.query(
    `insert into public.background_jobs
      (organization_id, job_type, entity_type, entity_id, status, next_attempt_at)
     values
      ($1, 'shipment-booking', 'shipment', $2, 'QUEUED', $3::timestamptz),
      ($1, 'shipment-booking', 'shipment', $4, 'RETRYING', $3::timestamptz),
      ($1, 'shipment-booking', 'shipment', $5, 'RUNNING', $3::timestamptz),
      ($1, 'shipment-booking', 'shipment', $6, 'QUEUED', null)`,
    [orgId, shipmentQueued, HISTORICAL_JOB_HOLD_AT, shipmentRetrying, shipmentStale, shipmentDue]
  );
  await db.query(
    `update public.background_jobs set locked_at = now() - interval '20 minutes'
     where entity_id = $1`,
    [shipmentStale]
  );
});

afterAll(async () => {
  await db?.close();
});

describe("claim_background_jobs historical hold", () => {
  it("claims due work and leaked stale RUNNING, but never 2099 QUEUED or RETRYING holds", async () => {
    const claimed = await db.query<{ entity_id: string }>(
      `select entity_id from public.claim_background_jobs(20, interval '15 minutes', array['shipment-booking']::text[])`
    );
    const ids = claimed.rows.map((row) => row.entity_id);
    expect(ids).toContain(shipmentDue);
    expect(ids).toContain(shipmentStale);
    expect(ids).not.toContain(shipmentQueued);
    expect(ids).not.toContain(shipmentRetrying);
  });
});
