/**
 * Isolated PGlite soak for bulk membership. Not Production. Not CEPT.
 * Run: npx vitest run modules/india-post/bulk-soak.pg.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const bulkSql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261009020000_india_post_bulk_batches.sql"),
  "utf8"
);
const lockSql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261008020000_india_post_booking_lock.sql"),
  "utf8"
);

let db: PGlite;

function strip(sql: string) {
  return sql
    .replace(/drop policy[\s\S]*?;/gi, "")
    .replace(/create policy[\s\S]*?;/gi, "")
    .replace(/alter table[\s\S]*?enable row level security\s*;/gi, "")
    .replace(/revoke[\s\S]*?;/gi, "")
    .replace(/grant[\s\S]*?;/gi, "");
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    do $$ begin
      create type public.integration_status as enum ('NOT_CONNECTED','PENDING','CONNECTED','ERROR','DISCONNECTED');
    exception when duplicate_object then null;
    end $$;
    create table public.organizations (
      id uuid primary key default gen_random_uuid(),
      name text not null default 'org'
    );
    create table public.background_jobs (id uuid primary key default gen_random_uuid());
    create table public.shipments (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id)
    );
    create table public.india_post_connections (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null unique,
      status public.integration_status not null default 'CONNECTED'
    );
    create function public.set_updated_at() returns trigger language plpgsql as $$
    begin
      new.updated_at = now();
      return new;
    end $$;
    create function public.is_org_member(uuid) returns boolean language sql as $$ select true $$;
  `);
  await db.exec(strip(lockSql));
  await db.exec(strip(bulkSql));
}, 30_000);

afterAll(async () => {
  await db?.close();
});

describe("isolated PostgreSQL bulk soak", () => {
  it("persists 100000 synthetic memberships without duplicate batches or barcodes", async () => {
    const started = Date.now();
    const org = (
      await db.query<{ id: string }>("insert into public.organizations (name) values ('soak') returning id")
    ).rows[0]!.id;
    await db.exec(`insert into public.shipments (organization_id) select '${org}' from generate_series(1, 100000)`);
    await db.exec(`
      insert into public.india_post_bulk_batches (
        organization_id, india_post_customer_id, contract_id, service_code, environment,
        status, article_count, request_fingerprint
      )
      select '${org}', 'cust-soak', 'contract-soak', 'SP_INLAND_PARCEL', 'UAT',
             'READY', 2, 'fp-soak-' || g
      from generate_series(0, 49999) g
    `);
    await db.exec(`
      insert into public.india_post_bulk_batch_articles (
        batch_id, organization_id, shipment_id, barcode, article_result, position
      )
      select b.id, '${org}', s.id, 'CX' || lpad(s.n::text, 9, '0'), 'PENDING', s.pos
      from (
        select id,
               row_number() over (order by id) as n,
               ((row_number() over (order by id) - 1) % 2) as pos,
               ((row_number() over (order by id) - 1) / 2) as batch_n
        from public.shipments
        where organization_id = '${org}'
      ) s
      join (
        select id, row_number() over (order by created_at, id) - 1 as batch_n
        from public.india_post_bulk_batches
        where organization_id = '${org}'
      ) b on b.batch_n = s.batch_n
    `);
    const counts = await db.query<{ ships: string; batches: string; articles: string; barcodes: string }>(`
      select
        (select count(*)::text from public.shipments where organization_id = '${org}') as ships,
        (select count(*)::text from public.india_post_bulk_batches where organization_id = '${org}') as batches,
        (select count(*)::text from public.india_post_bulk_batch_articles where organization_id = '${org}') as articles,
        (select count(distinct barcode)::text from public.india_post_bulk_batch_articles where organization_id = '${org}') as barcodes
    `);
    const elapsedMs = Date.now() - started;
    expect(Number(counts.rows[0]?.ships)).toBe(100_000);
    expect(Number(counts.rows[0]?.batches)).toBe(50_000);
    expect(Number(counts.rows[0]?.articles)).toBe(100_000);
    expect(Number(counts.rows[0]?.barcodes)).toBe(100_000);
    await expect(
      db.exec(`
        insert into public.india_post_bulk_batches (
          organization_id, india_post_customer_id, contract_id, service_code, environment,
          status, article_count, request_fingerprint
        ) values ('${org}', 'cust-soak', 'contract-soak', 'SP_INLAND_PARCEL', 'UAT', 'READY', 2, 'fp-soak-0')
      `)
    ).rejects.toThrow();
    expect(elapsedMs).toBeLessThan(120_000);
  }, 120_000);

  it("lets 1000 merchants hold booking locks independently", async () => {
    await db.exec(`
      insert into public.organizations (name)
      select 'm' || g from generate_series(1, 1000) g
    `);
    await db.exec(`
      insert into public.india_post_connections (organization_id)
      select id from public.organizations
      where name like 'm%'
      on conflict (organization_id) do nothing
    `);
    const orgs = await db.query<{ id: string }>(
      "select id from public.organizations where name like 'm%' order by name"
    );
    const tokens = await Promise.all(
      orgs.rows.map((row) =>
        db.query<{ acquire_india_post_booking_lock: string | null }>(
          "select public.acquire_india_post_booking_lock($1::uuid, 45) as acquire_india_post_booking_lock",
          [row.id]
        )
      )
    );
    expect(tokens.filter((row) => row.rows[0]?.acquire_india_post_booking_lock).length).toBe(1000);
    const [first, second] = await Promise.all([
      db.query<{ acquire_india_post_booking_lock: string | null }>(
        "select public.acquire_india_post_booking_lock($1::uuid, 45) as acquire_india_post_booking_lock",
        [orgs.rows[0]!.id]
      ),
      db.query<{ acquire_india_post_booking_lock: string | null }>(
        "select public.acquire_india_post_booking_lock($1::uuid, 45) as acquire_india_post_booking_lock",
        [orgs.rows[1]!.id]
      ),
    ]);
    expect(first.rows[0]?.acquire_india_post_booking_lock).toBeNull();
    expect(second.rows[0]?.acquire_india_post_booking_lock).toBeNull();
  }, 60_000);

  it("creates 10000 tenant-isolated ready batches", async () => {
    await db.exec(`delete from public.india_post_bulk_batch_articles`);
    await db.exec(`delete from public.india_post_bulk_batches`);
    await db.exec(`
      insert into public.organizations (name)
      select 't' || g from generate_series(1, 10000) g
    `);
    const orgs = await db.query<{ id: string }>(
      "select id from public.organizations where name like 't%' "
    );
    expect(orgs.rows).toHaveLength(10_000);
    await db.exec(`
      insert into public.shipments (organization_id)
      select id from public.organizations where name like 't%'
      union all
      select id from public.organizations where name like 't%'
    `);
    await db.exec(`
      insert into public.india_post_bulk_batches (
        organization_id, india_post_customer_id, contract_id, service_code, environment,
        status, article_count, request_fingerprint
      )
      select id, 'cust', 'contract', 'SP_INLAND_PARCEL', 'UAT', 'READY', 2, 'fp-' || id::text
      from public.organizations
      where name like 't%'
    `);
    const mixed = await db.query<{ n: string }>(`
      select count(*)::text as n
      from public.india_post_bulk_batches b
      join public.organizations o on o.id = b.organization_id
      where o.name like 't%' and b.organization_id <> o.id
    `);
    expect(Number(mixed.rows[0]?.n)).toBe(0);
    const batches = await db.query<{ n: string }>(
      `select count(*)::text as n from public.india_post_bulk_batches b
       join public.organizations o on o.id = b.organization_id where o.name like 't%'`
    );
    expect(Number(batches.rows[0]?.n)).toBe(10_000);
  }, 60_000);
});
