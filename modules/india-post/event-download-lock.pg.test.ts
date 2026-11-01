/**
 * PostgreSQL concurrency proof for Event Download leases.
 * Run: npx vitest run modules/india-post/event-download-lock.pg.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { withEventDownloadLeases } from "@/modules/india-post/event-download-lock";

const lockSql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261021153000_tracking_lookback_and_event_download_lease.sql"),
  "utf8"
);

let db: PGlite;
let orgA: string;
let orgB: string;

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
        if (name === "acquire_tracking_event_download_lock") {
          const result = await db.query<{ acquire_tracking_event_download_lock: string | null }>(
            "select public.acquire_tracking_event_download_lock($1::uuid, $2::text, $3::text, $4::text, $5::int) as acquire_tracking_event_download_lock",
            [
              args.p_organization_id,
              args.p_cust_id,
              args.p_event_code,
              args.p_event_date,
              args.p_ttl_seconds ?? 90,
            ]
          );
          return { data: result.rows[0]?.acquire_tracking_event_download_lock ?? null, error: null };
        }
        if (name === "release_tracking_event_download_lock") {
          await db.query(
            "select public.release_tracking_event_download_lock($1::uuid, $2::text, $3::text, $4::text, $5::uuid)",
            [args.p_organization_id, args.p_cust_id, args.p_event_code, args.p_event_date, args.p_token]
          );
          return { data: null, error: null };
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
    create table public.organizations (
      id uuid primary key default gen_random_uuid(),
      name text not null default 'org'
    );
    create or replace function public.is_org_member(p_org uuid)
    returns boolean language sql as $$ select true $$;
  `);
  await db.exec(withoutGrants(lockSql));
  const orgs = await db.query<{ id: string }>("insert into public.organizations (name) values ('a'), ('b') returning id");
  orgA = orgs.rows[0]!.id;
  orgB = orgs.rows[1]!.id;
});

afterAll(async () => {
  await db?.close();
});

describe("event download postgres lease", () => {
  it("serializes two workers on the same org/customer/date", async () => {
    const supabase = pgliteRpc();
    let inFlight = 0;
    let max = 0;
    await Promise.all([
      withEventDownloadLeases(
        supabase as never,
        { organizationId: orgA, custId: "0000002954", eventDates: ["21102026"], waitMs: 2000 },
        async () => {
          inFlight += 1;
          max = Math.max(max, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 40));
          inFlight -= 1;
        }
      ),
      withEventDownloadLeases(
        supabase as never,
        { organizationId: orgA, custId: "0000002954", eventDates: ["21102026"], waitMs: 2000 },
        async () => {
          inFlight += 1;
          max = Math.max(max, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 10));
          inFlight -= 1;
        }
      ),
    ]);
    expect(max).toBe(1);
  });

  it("does not block a second tenant on the same event date", async () => {
    const supabase = pgliteRpc();
    let overlap = 0;
    let aRunning = false;
    await Promise.all([
      withEventDownloadLeases(
        supabase as never,
        { organizationId: orgA, custId: "0000002954", eventDates: ["20102026"] },
        async () => {
          aRunning = true;
          await new Promise((resolve) => setTimeout(resolve, 30));
          aRunning = false;
        }
      ),
      withEventDownloadLeases(
        supabase as never,
        { organizationId: orgB, custId: "0000002954", eventDates: ["20102026"] },
        async () => {
          if (aRunning) overlap += 1;
        }
      ),
    ]);
    expect(overlap).toBe(1);
  });

  it("lets a later worker steal an expired lease", async () => {
    const supabase = pgliteRpc();
    await db.query(
      `insert into public.tracking_event_download_leases
        (organization_id, cust_id, event_code, event_date, lease_token, lease_expires_at)
       values ($1, '0000002954', 'LE', '19102026', gen_random_uuid(), now() - interval '1 second')`,
      [orgA]
    );
    const dates = await withEventDownloadLeases(
      supabase as never,
      { organizationId: orgA, custId: "0000002954", eventDates: ["19102026"], waitMs: 500 },
      async (held) => held
    );
    expect(dates).toEqual(["19102026"]);
  });
});
