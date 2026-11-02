/**
 * PostgreSQL integration tests for replace_shopify_order_line_items.
 * In-process PGlite only. Never production. Never live Shopify.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

let db: PGlite;
const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const orderA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const orderB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const orderC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

async function replaceLines(
  organizationId: string,
  orderId: string,
  updatedAt: string | null,
  lines: unknown[]
) {
  const result = await db.query<{ replace_shopify_order_line_items: unknown }>(
    `select public.replace_shopify_order_line_items($1::uuid, $2::uuid, $3::timestamptz, $4::jsonb) as replace_shopify_order_line_items`,
    [organizationId, orderId, updatedAt, JSON.stringify(lines)]
  );
  return result.rows[0]?.replace_shopify_order_line_items as { ok?: boolean; action?: string; count?: number };
}

async function lineTitles(orderId: string) {
  const result = await db.query<{ title: string; quantity: number; source_line_item_id: string | null }>(
    `select title, quantity, source_line_item_id from public.order_line_items where order_id = $1 order by source_line_item_id`,
    [orderId]
  );
  return result.rows;
}

const deposit = {
  title: "Product A",
  sku: "A",
  quantity: 1,
  unit_price: 314.7,
  source_line_item_id: "gid://shopify/LineItem/1",
};
const active = {
  title: "Product A",
  sku: "A",
  quantity: 1,
  unit_price: 1049,
  source_line_item_id: "gid://shopify/LineItem/2",
};
const activeSameSku = {
  title: "Product A XL",
  sku: "A",
  quantity: 1,
  unit_price: 1049,
  source_line_item_id: "gid://shopify/LineItem/3",
};

describe("replace_shopify_order_line_items", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create table public.organizations (id uuid primary key);
      create table public.orders (
        id uuid primary key,
        organization_id uuid not null,
        status text not null default 'READY',
        metadata jsonb not null default '{}'::jsonb
      );
      create table public.shipments (
        id uuid primary key,
        organization_id uuid not null,
        order_id uuid not null,
        status text not null default 'DRAFT',
        booked_at timestamptz
      );
      create table public.order_line_items (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid not null,
        order_id uuid not null,
        title text not null,
        sku text,
        quantity integer not null check (quantity > 0),
        unit_price numeric not null default 0,
        weight_grams integer
      );
      insert into public.organizations (id) values ('${orgA}'), ('${orgB}');
      insert into public.orders (id, organization_id, status, metadata) values
        ('${orderA}', '${orgA}', 'READY', '{"shopifyPayment":{"updatedAt":"2026-10-14T12:00:00Z"}}'),
        ('${orderB}', '${orgA}', 'READY', '{}'),
        ('${orderC}', '${orgB}', 'READY', '{}');
    `);
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20261101090000_replace_shopify_order_line_items.sql"),
      "utf8"
    );
    await db.exec(sql);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("C1 sequential identical updates keep one active set", async () => {
    await replaceLines(orgA, orderA, "2026-10-14T13:00:00Z", [active]);
    await replaceLines(orgA, orderA, "2026-10-14T13:00:00Z", [active]);
    expect(await lineTitles(orderA)).toEqual([
      expect.objectContaining({ source_line_item_id: "gid://shopify/LineItem/2", quantity: 1 }),
    ]);
  });

  it("C2/C3 concurrent identical replaces leave one set", async () => {
    await Promise.all([
      replaceLines(orgA, orderA, "2026-10-14T14:00:00Z", [active]),
      replaceLines(orgA, orderA, "2026-10-14T14:00:00Z", [active]),
    ]);
    expect(await lineTitles(orderA)).toHaveLength(1);
  });

  it("C4 older Shopify snapshot cannot overwrite a newer stored snapshot", async () => {
    const skipped = await replaceLines(orgA, orderA, "2026-10-14T11:00:00Z", [deposit]);
    expect(skipped.action).toBe("skipped_stale");
    expect(await lineTitles(orderA)).toEqual([
      expect.objectContaining({ source_line_item_id: "gid://shopify/LineItem/2" }),
    ]);
  });

  it("C5 invalid payload rolls back previous consistent rows", async () => {
    await expect(
      replaceLines(orgA, orderA, "2026-10-14T15:00:00Z", [
        { ...active, title: "" },
      ])
    ).rejects.toThrow(/title is required/);
    expect(await lineTitles(orderA)).toEqual([
      expect.objectContaining({ source_line_item_id: "gid://shopify/LineItem/2" }),
    ]);
  });

  it("C6 two orders in the same org can replace independently", async () => {
    await Promise.all([
      replaceLines(orgA, orderA, "2026-10-14T16:00:00Z", [active]),
      replaceLines(orgA, orderB, "2026-10-14T16:00:00Z", [{ ...active, title: "Other" }]),
    ]);
    expect(await lineTitles(orderB)).toEqual([expect.objectContaining({ title: "Other" })]);
  });

  it("C7 tenant B cannot replace tenant A lines", async () => {
    await expect(replaceLines(orgB, orderA, "2026-10-14T16:00:00Z", [active])).rejects.toThrow(/order not found/);
    expect(await lineTitles(orderA)).toEqual([
      expect.objectContaining({ source_line_item_id: "gid://shopify/LineItem/2" }),
    ]);
  });

  it("C8 two active same-SKU LineItem IDs remain separate", async () => {
    await replaceLines(orgA, orderA, "2026-10-14T17:00:00Z", [active, activeSameSku]);
    expect(await lineTitles(orderA)).toHaveLength(2);
  });

  it("C9 quantity 0 is rejected and never inserted", async () => {
    await expect(
      replaceLines(orgA, orderA, "2026-10-14T18:00:00Z", [{ ...deposit, quantity: 0 }])
    ).rejects.toThrow(/quantity must be > 0/);
  });

  it("C10 booked shipment skips line rewrite", async () => {
    await db.exec(
      `insert into public.shipments (id, organization_id, order_id, status, booked_at)
       values ('33333333-3333-4333-8333-333333333333', '${orgB}', '${orderC}', 'BOOKED', now())`
    );
    const skipped = await replaceLines(orgB, orderC, "2026-10-14T19:00:00Z", [active]);
    expect(skipped.action).toBe("skipped_locked");
    expect(await lineTitles(orderC)).toEqual([]);
  });
});
