/**
 * Isolated PGlite proof for Shopify public-app org provision.
 * Does not connect to production Supabase.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;

describe("provision_shopify_app_organization", () => {
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
    const sql = readFileSync("supabase/migrations/20261020120000_shopify_public_app_foundation.sql", "utf8")
      .split("\n")
      .filter((line) => !/^\s*(revoke|grant)\b/i.test(line))
      .join("\n");
    await db.exec(sql);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("creates one organization for concurrent first launches", async () => {
    const shop = "alpha-shop.myshopify.com";
    const app = "public-client";
    const results = await Promise.all([
      db.query("select * from provision_shopify_app_organization($1, $2, $3)", [shop, app, "Alpha"]),
      db.query("select * from provision_shopify_app_organization($1, $2, $3)", [shop, app, "Alpha"]),
    ]);
    const orgs = results.flatMap((row) => row.rows as { org_id: string }[]);
    expect(new Set(orgs.map((row) => row.org_id)).size).toBe(1);
    const count = await db.query("select count(*)::int as n from organizations");
    expect((count.rows[0] as { n: number }).n).toBe(1);
  });

  it("does not link by email and rejects a second shop claiming the first install shop domain", async () => {
    await db.query("insert into organizations (name, slug, origin) values ($1, $2, $3)", [
      "Standalone",
      "standalone-email",
      "WEB",
    ]);
    const first = await db.query("select * from provision_shopify_app_organization($1, $2, $3)", [
      "beta-shop.myshopify.com",
      "public-client",
      "Beta",
    ]);
    const org = (first.rows[0] as { org_id: string }).org_id;
    const standalone = await db.query("select id from organizations where slug = $1", ["standalone-email"]);
    expect(org).not.toBe((standalone.rows[0] as { id: string }).id);

    await expect(
      db.query("insert into shopify_app_installations (organization_id, shop_domain, app_client_id) values ($1, $2, $3)", [
        org,
        "beta-shop.myshopify.com",
        "other-app",
      ])
    ).rejects.toThrow();
  });

  it("reinstall restores a disconnected installation without a second organization", async () => {
    const shop = "gamma-shop.myshopify.com";
    const first = await db.query("select * from provision_shopify_app_organization($1, $2, $3)", [
      shop,
      "public-client",
      "Gamma",
    ]);
    const installationId = (first.rows[0] as { install_id: string }).install_id;
    const organizationId = (first.rows[0] as { org_id: string }).org_id;
    await db.query("update shopify_app_installations set status = $1 where id = $2", ["DISCONNECTED", installationId]);
    const second = await db.query("select * from provision_shopify_app_organization($1, $2, $3)", [
      shop,
      "public-client",
      "Gamma",
    ]);
    expect((second.rows[0] as { org_id: string }).org_id).toBe(organizationId);
    expect((second.rows[0] as { is_new: boolean }).is_new).toBe(false);
    const status = await db.query("select status from shopify_app_installations where id = $1", [installationId]);
    expect((status.rows[0] as { status: string }).status).toBe("PENDING");
  });

  it("provisions shop A and shop B as separate organizations without OWNER members", async () => {
    const a = await db.query("select * from provision_shopify_app_organization($1, $2, $3)", [
      "shop-a.myshopify.com",
      "public-client",
      "Shop A",
    ]);
    const b = await db.query("select * from provision_shopify_app_organization($1, $2, $3)", [
      "shop-b.myshopify.com",
      "public-client",
      "Shop B",
    ]);
    const orgA = (a.rows[0] as { org_id: string }).org_id;
    const orgB = (b.rows[0] as { org_id: string }).org_id;
    expect(orgA).not.toBe(orgB);
    const members = await db.query("select count(*)::int as n from organization_members");
    expect((members.rows[0] as { n: number }).n).toBe(0);
    const repeat = await db.query("select * from provision_shopify_app_organization($1, $2, $3)", [
      "shop-a.myshopify.com",
      "public-client",
      "Shop A",
    ]);
    expect((repeat.rows[0] as { org_id: string }).org_id).toBe(orgA);
    expect((repeat.rows[0] as { is_new: boolean }).is_new).toBe(false);
  });
});
