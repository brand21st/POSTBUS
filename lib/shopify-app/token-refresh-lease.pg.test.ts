/**
 * Isolated PGlite proof for the Shopify token refresh lease.
 * Does not connect to production Supabase.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;
let installationId: string;

function migration(path: string) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(revoke|grant)\b/i.test(line))
    .join("\n");
}

async function claim(version: number, leaseSeconds = 30) {
  const result = await db.query("select claim_shopify_token_refresh($1, $2, $3) as ok", [
    installationId,
    version,
    leaseSeconds,
  ]);
  return (result.rows[0] as { ok: boolean }).ok;
}

describe("claim_shopify_token_refresh", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
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
        organization_id uuid not null references public.organizations(id),
        user_id uuid not null,
        role text not null
      );
    `);
    await db.exec(migration("supabase/migrations/20261020120000_shopify_public_app_foundation.sql"));
    await db.exec(migration("supabase/migrations/20261023100000_shopify_token_refresh_lease.sql"));
    const org = await db.query("insert into organizations (name) values ('Lease') returning id");
    const orgId = (org.rows[0] as { id: string }).id;
    const install = await db.query(
      "insert into shopify_app_installations (organization_id, shop_domain, app_client_id) values ($1, $2, $3) returning id",
      [orgId, "lease-shop.myshopify.com", "public-client"]
    );
    installationId = (install.rows[0] as { id: string }).id;
  });

  afterAll(async () => {
    await db?.close();
  });

  it("grants the lease to exactly one caller", async () => {
    const results = await Promise.all([claim(0), claim(0), claim(0)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("refuses a stale version after the winner bumps token_version", async () => {
    await db.query(
      "update shopify_app_installations set token_version = token_version + 1, token_refresh_lease_until = null where id = $1",
      [installationId]
    );
    expect(await claim(0)).toBe(false);
    expect(await claim(1)).toBe(true);
  });

  it("lets a new caller take over an expired lease", async () => {
    await db.query(
      "update shopify_app_installations set token_refresh_lease_until = now() - interval '1 second' where id = $1",
      [installationId]
    );
    expect(await claim(1)).toBe(true);
  });
});
