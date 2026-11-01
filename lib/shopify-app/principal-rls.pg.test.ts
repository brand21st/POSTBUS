/**
 * Isolated PGlite proof for the Shopify installation principal: attach races keep one principal,
 * and the principal only sees its own organization under the standard is_org_member RLS pattern.
 * Does not connect to production Supabase.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const USER_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const USER_A2 = "aaaaaaaa-0000-0000-0000-0000000000a2";
const USER_B = "bbbbbbbb-0000-0000-0000-00000000000b";

let db: PGlite;
let orgA: string;
let orgB: string;
let installA: string;
let installB: string;

function migration(path: string) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(revoke|grant)\b/i.test(line))
    .join("\n");
}

async function asUser(userId: string, sql: string, params: unknown[] = []) {
  await db.query("begin");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await db.query("set local role authenticated");
  try {
    const result = await db.query(sql, params);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function attach(installationId: string, userId: string, role = "OWNER") {
  const result = await db.query("select * from attach_shopify_app_principal($1, $2, $3, $4::public.member_role)", [
    installationId,
    userId,
    "sealed",
    role,
  ]);
  return result.rows[0] as { principal_user_id: string; attached: boolean };
}

describe("Shopify installation principal", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (id uuid primary key);
      create or replace function auth.uid() returns uuid
      language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create type public.member_role as enum ('OWNER','ADMIN','MANAGER','OPERATOR','VIEWER');
      create or replace function public.set_updated_at()
      returns trigger language plpgsql as $$
      begin new.updated_at = now(); return new; end; $$;
      create table public.organizations (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        slug text unique,
        created_by uuid,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table public.automation_settings (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid not null unique references public.organizations(id) on delete cascade
      );
      create table public.organization_members (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid not null references public.organizations(id) on delete cascade,
        user_id uuid not null references auth.users(id) on delete cascade,
        role public.member_role not null default 'VIEWER',
        unique (organization_id, user_id)
      );
      create or replace function public.is_org_member(org_id uuid)
      returns boolean language sql stable security definer set search_path = public as $$
        select exists (
          select 1 from public.organization_members m
          where m.organization_id = org_id and m.user_id = auth.uid()
        );
      $$;
      create table public.orders (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid not null references public.organizations(id),
        order_number text not null
      );
      alter table public.orders enable row level security;
      create policy orders_member on public.orders for select using (public.is_org_member(organization_id));
      do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
      grant usage on schema public to authenticated;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      grant select on public.orders to authenticated;
    `);
    await db.exec(migration("supabase/migrations/20261020120000_shopify_public_app_foundation.sql"));
    await db.exec(migration("supabase/migrations/20261023110000_shopify_app_principal.sql"));

    await db.exec(`insert into auth.users (id) values ('${USER_A}'), ('${USER_A2}'), ('${USER_B}');`);
    const a = await db.query("select * from provision_shopify_app_organization($1, $2, $3)", [
      "shop-a.myshopify.com",
      "client",
      "Shop A",
    ]);
    const b = await db.query("select * from provision_shopify_app_organization($1, $2, $3)", [
      "shop-b.myshopify.com",
      "client",
      "Shop B",
    ]);
    ({ org_id: orgA, install_id: installA } = a.rows[0] as { org_id: string; install_id: string });
    ({ org_id: orgB, install_id: installB } = b.rows[0] as { org_id: string; install_id: string });
    await db.query("insert into orders (organization_id, order_number) values ($1, 'A-1'), ($2, 'B-1')", [orgA, orgB]);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("keeps exactly one principal when two launches attach concurrently", async () => {
    const [first, second] = await Promise.all([attach(installA, USER_A), attach(installA, USER_A2)]);
    expect([first.attached, second.attached].filter(Boolean)).toHaveLength(1);
    expect(first.principal_user_id).toBe(second.principal_user_id);
    const members = await db.query("select user_id, role from organization_members where organization_id = $1", [orgA]);
    expect(members.rows).toEqual([{ user_id: first.principal_user_id, role: "OWNER" }]);
  });

  it("bumps the session version so stale cached sessions are discarded", async () => {
    await attach(installB, USER_B);
    const row = await db.query("select principal_session_version from shopify_app_installations where id = $1", [installB]);
    expect((row.rows[0] as { principal_session_version: number }).principal_session_version).toBe(1);
  });

  it("lets a principal read only its own organization's rows", async () => {
    const principalA = (
      await db.query("select principal_user_id from shopify_app_installations where id = $1", [installA])
    ).rows[0] as { principal_user_id: string };
    const seenByA = await asUser(principalA.principal_user_id, "select order_number from orders order by order_number");
    expect(seenByA.rows).toEqual([{ order_number: "A-1" }]);
    const seenByB = await asUser(USER_B, "select order_number from orders order by order_number");
    expect(seenByB.rows).toEqual([{ order_number: "B-1" }]);
  });

  it("refuses an unknown installation", async () => {
    await expect(attach("00000000-0000-0000-0000-000000000000", USER_B)).rejects.toThrow(/installation not found/);
  });
});
