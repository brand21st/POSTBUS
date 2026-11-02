/**
 * Applies the AutoPack migration to real Postgres (in-process PGlite) on top of minimal stubs
 * and checks its constraints. No hosted database is touched.
 *
 * Run: npx vitest run modules/autopack/autopack-migration.pg.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migration = (name: string) =>
  readFileSync(path.join(process.cwd(), "supabase/migrations", name), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(revoke|grant)\b/i.test(line))
    .join("\n");

const KEY = "a".repeat(64);
let db: PGlite;
let org: string;
let order: string;
let shipment: string;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table public.organizations (id uuid primary key default gen_random_uuid(), name text not null default 'org');
    create function public.is_org_member(org uuid) returns boolean language sql stable as $$ select true $$;
    create function public.set_updated_at() returns trigger language plpgsql as $$
      begin new.updated_at := now(); return new; end; $$;
    create table public.orders (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id));
    create table public.shipments (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id));
    create table public.order_line_items (id uuid primary key default gen_random_uuid(), organization_id uuid not null, order_id uuid not null);
    create table public.automation_settings (organization_id uuid primary key);
  `);
  await db.exec(migration("20261008170000_user_shipment_presets.sql"));
  await db.exec(migration("20261101130000_autopack_custom_sizes.sql"));
  // Re-running must be safe (deploy retries).
  await db.exec(migration("20261101130000_autopack_custom_sizes.sql"));

  org = (await db.query<{ id: string }>("insert into public.organizations default values returning id")).rows[0].id;
  order = (await db.query<{ id: string }>("insert into public.orders (organization_id) values ($1) returning id", [org])).rows[0].id;
  shipment = (
    await db.query<{ id: string }>("insert into public.shipments (organization_id) values ($1) returning id", [org])
  ).rows[0].id;
});

afterAll(async () => {
  await db?.close();
});

async function insertHistory(overrides: Record<string, unknown> = {}) {
  const row = {
    organization_id: org,
    order_id: order,
    shipment_id: shipment,
    composition_key: KEY,
    composition: JSON.stringify([{ variantId: "1", qty: 2 }]),
    unit_count: 2,
    length_cm: 30,
    width_cm: 25,
    height_cm: 15,
    service_code: "SP_INLAND_PARCEL",
    package_source: "custom",
    evidence_level: "entered",
    verified_at: null as string | null,
    ...overrides,
  };
  const columns = Object.keys(row);
  const values = Object.values(row);
  return db.query<Record<string, unknown>>(
    `insert into public.packaging_history (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
    values
  );
}

describe("AutoPack migration", () => {
  it("adds variant columns, the opt-in flag (default off) and the history table", async () => {
    const columns = await db.query<{ table_name: string; column_name: string; column_default: string | null }>(
      `select table_name, column_name, column_default from information_schema.columns
        where (table_name = 'order_line_items' and column_name in ('shopify_variant_id', 'shopify_product_id'))
           or (table_name = 'automation_settings' and column_name = 'auto_package_selection')`
    );
    expect(columns.rows).toHaveLength(3);
    expect(columns.rows.find((row) => row.column_name === "auto_package_selection")?.column_default).toBe("false");
    await db.query("insert into public.automation_settings (organization_id) values ($1)", [org]);
    const flag = await db.query<{ auto_package_selection: boolean }>(
      "select auto_package_selection from public.automation_settings where organization_id = $1",
      [org]
    );
    expect(flag.rows[0].auto_package_selection).toBe(false);
  });

  it("stores an entered custom box with defaults", async () => {
    const result = await insertHistory();
    expect(result.rows[0]).toMatchObject({ evidence_level: "entered", superseded_at: null, rejected_order_ids: [] });
  });

  it("rejects malformed keys, bad dimensions, unknown sources and levels", async () => {
    await expect(insertHistory({ composition_key: "abc" })).rejects.toThrow();
    await expect(insertHistory({ length_cm: 151 })).rejects.toThrow();
    await expect(insertHistory({ height_cm: 0 })).rejects.toThrow();
    await expect(insertHistory({ package_source: "ai_guess" })).rejects.toThrow();
    await expect(insertHistory({ evidence_level: "probably" })).rejects.toThrow();
    await expect(insertHistory({ unit_count: 0 })).rejects.toThrow();
    await expect(insertHistory({ composition: JSON.stringify({ not: "array" }) })).rejects.toThrow();
  });

  it("verified requires verified_at and verified_at requires verified", async () => {
    await expect(insertHistory({ evidence_level: "verified" })).rejects.toThrow();
    await expect(insertHistory({ evidence_level: "confirmed", verified_at: new Date().toISOString() })).rejects.toThrow();
    const ok = await insertHistory({ evidence_level: "verified", verified_at: new Date().toISOString() });
    expect(ok.rows[0].evidence_level).toBe("verified");
  });

  it("presets become workspace-wide: per-member policy is replaced by org policies", async () => {
    const policies = await db.query<{ policyname: string }>(
      "select policyname from pg_policies where tablename = 'user_shipment_presets' order by policyname"
    );
    expect(policies.rows.map((row) => row.policyname)).toEqual([
      "user_shipment_presets_org_delete",
      "user_shipment_presets_org_insert",
      "user_shipment_presets_org_select",
      "user_shipment_presets_org_update",
    ]);
    const history = await db.query<{ policyname: string }>(
      "select policyname from pg_policies where tablename = 'packaging_history' order by policyname"
    );
    expect(history.rows.map((row) => row.policyname)).toEqual([
      "packaging_history_insert",
      "packaging_history_select",
      "packaging_history_update",
    ]);
  });
});
