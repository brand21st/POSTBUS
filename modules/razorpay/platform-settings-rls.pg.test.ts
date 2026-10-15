/**
 * Real PostgreSQL proof that platform_settings secrets are not readable by JWT roles.
 * Uses in-process PGlite. Does not connect to production.
 *
 * Run: npx vitest run modules/razorpay/platform-settings-rls.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const USER_A = "11111111-1111-1111-1111-111111111111";

let db: PGlite;

async function asRole(role: "anon" | "authenticated" | "service_role", sql: string, params: unknown[] = []) {
  await db.query("begin");
  if (role === "authenticated") {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [USER_A]);
    await db.query("select set_config('request.jwt.claim.role', $1, true)", ["authenticated"]);
  }
  await db.query(`set local role ${role}`);
  try {
    const result = await db.query(sql, params);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

describe("platform_settings secret RLS", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create table public.platform_settings (
        id integer primary key default 1 check (id = 1),
        trial_enabled boolean not null default true,
        trial_days integer not null default 14,
        razorpay_key_id text,
        encrypted_razorpay_key_secret text,
        encrypted_razorpay_webhook_secret text,
        razorpay_webhook_id text
      );
      insert into public.platform_settings (id, razorpay_key_id, encrypted_razorpay_key_secret)
      values (1, 'rzp_test_leak', 'cipher.tag.blob');

      alter table public.platform_settings enable row level security;
      alter table public.platform_settings force row level security;

      create policy platform_settings_admin_select on public.platform_settings
        for select using (true);
      grant select on public.platform_settings to public;

      do $$ begin
        create role anon nologin;
      exception when duplicate_object then null; end $$;
      do $$ begin
        create role authenticated nologin;
      exception when duplicate_object then null; end $$;
      do $$ begin
        create role service_role nologin bypassrls;
      exception when duplicate_object then null; end $$;
      grant usage on schema public to anon, authenticated, service_role;

      revoke all on table public.platform_settings from public;
      revoke all on table public.platform_settings from anon;
      revoke all on table public.platform_settings from authenticated;
      grant select, insert, update, delete on table public.platform_settings to service_role;
      drop policy if exists platform_settings_admin_select on public.platform_settings;
    `);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("anon cannot read encrypted Razorpay columns", async () => {
    await expect(asRole("anon", "select encrypted_razorpay_key_secret from public.platform_settings")).rejects.toThrow();
  });

  it("authenticated cannot read platform_settings secrets", async () => {
    await expect(
      asRole("authenticated", "select id, encrypted_razorpay_key_secret, razorpay_key_id from public.platform_settings")
    ).rejects.toThrow();
  });

  it("authenticated cannot update or delete platform_settings", async () => {
    await expect(
      asRole("authenticated", "update public.platform_settings set trial_days = 1 where id = 1")
    ).rejects.toThrow();
    await expect(asRole("authenticated", "delete from public.platform_settings where id = 1")).rejects.toThrow();
  });

  it("service_role can select encrypted columns", async () => {
    const result = await asRole(
      "service_role",
      "select encrypted_razorpay_key_secret, razorpay_key_id from public.platform_settings where id = 1"
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.encrypted_razorpay_key_secret).toBe("cipher.tag.blob");
    expect(result.rows[0]?.razorpay_key_id).toBe("rzp_test_leak");
  });
});
