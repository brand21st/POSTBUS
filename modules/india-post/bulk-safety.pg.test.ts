/**
 * Real PostgreSQL uniqueness for India Post bulk batches (PGlite).
 * Run: npx vitest run modules/india-post/bulk-safety.pg.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const bulkSql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261009020000_india_post_bulk_batches.sql"),
  "utf8"
);

let db: PGlite;
let orgA: string;
let orgB: string;
let ship1: string;
let ship2: string;
let ship3: string;
let ship4: string;

function withoutPolicies(sql: string) {
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
    create table public.organizations (
      id uuid primary key default gen_random_uuid(),
      name text not null default 'org'
    );
    create table public.background_jobs (
      id uuid primary key default gen_random_uuid()
    );
    create table public.shipments (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id)
    );
    create function public.set_updated_at() returns trigger language plpgsql as $$
    begin
      new.updated_at = now();
      return new;
    end $$;
    create function public.is_org_member(uuid) returns boolean language sql as $$ select true $$;
  `);
  await db.exec(withoutPolicies(bulkSql));
  const orgs = await db.query<{ id: string }>(
    "insert into public.organizations (name) values ('A'), ('B') returning id"
  );
  orgA = orgs.rows[0]!.id;
  orgB = orgs.rows[1]!.id;
  const ships = await db.query<{ id: string }>(
    "insert into public.shipments (organization_id) select $1 from generate_series(1,4) returning id",
    [orgA]
  );
  ship1 = ships.rows[0]!.id;
  ship2 = ships.rows[1]!.id;
  ship3 = ships.rows[2]!.id;
  ship4 = ships.rows[3]!.id;
});

afterAll(async () => {
  await db?.close();
});

describe("PostgreSQL bulk batch uniqueness", () => {
  it("allows only one active batch for the same fingerprint", async () => {
    const first = await createBatch("fp-1", [ship1, ship2], ["A", "B"]);
    expect(first).toBeTruthy();
    await expect(createBatch("fp-1", [ship1, ship2], ["A", "B"])).rejects.toThrow();
  });

  it("rejects the same shipment in a second active batch", async () => {
    await expect(createBatch("fp-2", [ship1, ship3], ["A", "C"])).rejects.toThrow();
  });

  it("keeps two organizations from sharing a batch row", async () => {
    const created = await db.query<{ id: string }>(
      `select id from public.india_post_bulk_batches where organization_id = $1 limit 1`,
      [orgA]
    );
    await expect(
      db.query(
        `insert into public.india_post_bulk_batch_articles (batch_id, organization_id, shipment_id, barcode, position)
         values ($1, $2, $3, 'X', 99)`,
        [created.rows[0]!.id, orgB, ship4]
      )
    ).rejects.toThrow();
  });

  it("makes membership immutable", async () => {
    const row = await db.query<{ id: string }>(
      "select id from public.india_post_bulk_batch_articles where shipment_id = $1",
      [ship1]
    );
    await expect(
      db.query("update public.india_post_bulk_batch_articles set position = 9 where id = $1", [row.rows[0]!.id])
    ).rejects.toThrow(/immutable/);
  });

  it("does not allow a second POST-ready batch after SUCCESS", async () => {
    await db.query("update public.india_post_bulk_batches set status = 'SUCCEEDED' where request_fingerprint = 'fp-1'");
    await expect(createBatch("fp-1", [ship3, ship4], ["C", "D"])).rejects.toThrow();
  });

  it("allows a new batch after FAILED with the same fingerprint", async () => {
    await db.query("delete from public.india_post_bulk_batches");
    const batch = await createBatch("fp-fail", [ship3, ship4], ["C", "D"]);
    await db.query("update public.india_post_bulk_batch_articles set article_result = 'FAILED' where batch_id = $1", [
      batch,
    ]);
    await db.query("update public.india_post_bulk_batches set status = 'FAILED' where id = $1", [batch]);
    const again = await createBatch("fp-fail", [ship3, ship4], ["C", "D"]);
    expect(again).toBeTruthy();
    expect(again).not.toBe(batch);
  });

  it("rejects a second active membership with the same barcode", async () => {
    await db.query("delete from public.india_post_bulk_batches");
    await createBatch("fp-bar-1", [ship1, ship2], ["AWB-1", "AWB-2"]);
    await expect(createBatch("fp-bar-2", [ship3, ship4], ["AWB-1", "AWB-4"])).rejects.toThrow();
  });

  it("lets only one concurrent fingerprint insert succeed", async () => {
    await db.query("delete from public.india_post_bulk_batches");
    const results = await Promise.allSettled([
      createBatch("fp-race", [ship1, ship2], ["A", "B"]),
      createBatch("fp-race", [ship1, ship2], ["A", "B"]),
    ]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((row) => row.status === "rejected")).toHaveLength(1);
  });
});

async function createBatch(fingerprint: string, shipmentIds: string[], barcodes: string[]) {
  const result = await db.query<{ create_india_post_bulk_batch: string }>(
    `select public.create_india_post_bulk_batch(
      $1::uuid, $2::text, $3::text, $4::text, 'PRODUCTION', $5::text, null,
      $6::uuid[], $7::text[]
    ) as create_india_post_bulk_batch`,
    [orgA, "cust-a", "contract-a", "SP_INLAND_PARCEL", fingerprint, shipmentIds, barcodes]
  );
  return result.rows[0]!.create_india_post_bulk_batch;
}
