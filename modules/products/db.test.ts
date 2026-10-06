import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261007020000_inventory_products.sql"),
  "utf8"
);

let db: PGlite;
let orgA: string;
let orgB: string;
let userA: string;
let productA: string;

async function asUser(userId: string) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key,
      email text
    );
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    create or replace function public.set_updated_at()
    returns trigger language plpgsql as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$;

    do $$ begin
      create type public.member_role as enum ('OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER');
    exception when duplicate_object then null;
    end $$;

    create table public.organizations (
      id uuid primary key default gen_random_uuid(),
      name text not null
    );

    create table public.organization_members (
      organization_id uuid not null references public.organizations(id) on delete cascade,
      user_id uuid not null,
      role public.member_role not null default 'VIEWER',
      primary key (organization_id, user_id)
    );

    create or replace function public.is_org_member(org_id uuid)
    returns boolean language sql stable security definer set search_path = public as $$
      select exists (
        select 1 from public.organization_members m
        where m.organization_id = org_id and m.user_id = auth.uid()
      );
    $$;

    create or replace function public.has_org_role(org_id uuid, roles public.member_role[])
    returns boolean language sql stable security definer set search_path = public as $$
      select exists (
        select 1 from public.organization_members m
        where m.organization_id = org_id and m.user_id = auth.uid() and m.role = any(roles)
      );
    $$;

    create table public.orders (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid
    );
    create table public.order_line_items (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid,
      order_id uuid
    );
  `);
  await db.exec(
    migration
      .replace(/revoke all[\s\S]*?;/gi, "")
      .replace(/grant execute[\s\S]*?;/gi, "")
  );

  const orgRows = await db.query<{ id: string }>(
    "insert into public.organizations (name) values ('A'), ('B') returning id"
  );
  orgA = orgRows.rows[0].id;
  orgB = orgRows.rows[1].id;
  userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  const viewer = crypto.randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, 'a@x.com'), ($2, 'b@x.com'), ($3, 'v@x.com')", [
    userA,
    userB,
    viewer,
  ]);
  await db.query(
    "insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'OWNER'), ($3, $4, 'OWNER'), ($1, $5, 'VIEWER')",
    [orgA, userA, orgB, userB, viewer]
  );

  await asUser(userA);
  const created = await db.query<{ create_inventory_product: string }>(
    `select public.create_inventory_product($1, 'Premium T-Shirt', 'TSHIRT-001', 999, 250, true, true, 30, 100, $2) as create_inventory_product`,
    [orgA, userA]
  );
  productA = created.rows[0].create_inventory_product;
});

afterAll(async () => {
  await db?.close();
});

describe("inventory database", () => {
  it("creates a product, balance, and OPENING movement", async () => {
    const stock = await db.query<{ on_hand: number }>(
      "select on_hand from public.inventory_balances where product_id = $1",
      [productA]
    );
    expect(stock.rows[0].on_hand).toBe(100);
    const movements = await db.query<{ reason: string; quantity_delta: number; balance_after: number }>(
      "select reason::text, quantity_delta, balance_after from public.inventory_movements where product_id = $1",
      [productA]
    );
    expect(movements.rows).toEqual([
      { reason: "OPENING", quantity_delta: 100, balance_after: 100 },
    ]);
  });

  it("allows the same SKU in another organization", async () => {
    const otherUser = await db.query<{ user_id: string }>(
      "select user_id from public.organization_members where organization_id = $1 and role = 'OWNER'",
      [orgB]
    );
    await asUser(otherUser.rows[0].user_id);
    const created = await db.query<{ id: string }>(
      `select public.create_inventory_product($1, 'Premium T-Shirt', 'TSHIRT-001', 999, 250, true, true, 0, 0, $2) as id`,
      [orgB, otherUser.rows[0].user_id]
    );
    expect(created.rows[0].id).toBeTruthy();
  });

  it("rejects a duplicate SKU in the same organization", async () => {
    await asUser(userA);
    await expect(
      db.query(
        `select public.create_inventory_product($1, 'Copy', 'TSHIRT-001', 1, 1, true, true, 0, 0, $2)`,
        [orgA, userA]
      )
    ).rejects.toThrow();
  });

  it("applies a positive then negative adjustment and records movements", async () => {
    await asUser(userA);
    await db.query(
      `select public.adjust_inventory($1, $2, 20, 'ADJUSTMENT', 'New stock received', $3, null, null)`,
      [orgA, productA, userA]
    );
    await db.query(
      `select public.adjust_inventory($1, $2, -5, 'ADJUSTMENT', 'Damaged product', $3, null, null)`,
      [orgA, productA, userA]
    );
    const stock = await db.query<{ on_hand: number }>(
      "select on_hand from public.inventory_balances where product_id = $1",
      [productA]
    );
    expect(stock.rows[0].on_hand).toBe(115);
  });

  it("prevents negative stock", async () => {
    await asUser(userA);
    await expect(
      db.query(`select public.adjust_inventory($1, $2, -1000, 'ADJUSTMENT', 'too much', $3, null, null)`, [
        orgA,
        productA,
        userA,
      ])
    ).rejects.toThrow(/below zero/i);
    const stock = await db.query<{ on_hand: number }>(
      "select on_hand from public.inventory_balances where product_id = $1",
      [productA]
    );
    expect(stock.rows[0].on_hand).toBe(115);
  });

  it("locks the balance row during adjustment", () => {
    expect(migration).toContain("for update");
  });

  it("blocks a viewer from adjusting stock", async () => {
    const viewer = await db.query<{ user_id: string }>(
      "select user_id from public.organization_members where organization_id = $1 and role = 'VIEWER'",
      [orgA]
    );
    await asUser(viewer.rows[0].user_id);
    await expect(
      db.query(`select public.adjust_inventory($1, $2, 1, 'ADJUSTMENT', 'nope', $3, null, null)`, [
        orgA,
        productA,
        viewer.rows[0].user_id,
      ])
    ).rejects.toThrow(/permission/i);
  });
});
