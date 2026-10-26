/**
 * Real PostgreSQL proof for the manifests lifecycle migration (PGlite, not a mocked builder).
 *
 * Run: npx vitest run modules/manifests/db.pg.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261027100000_manifests_lifecycle.sql"),
  "utf8"
);

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const OFFICE = "22660454";

let db: PGlite;
let orgA: string;
let orgB: string;
let legacyKeep: string;
let legacyOld: string;
let legacyShipment: string;

async function asUser<T>(userId: string, sql: string, params: unknown[] = []) {
  await db.query("begin");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await db.query("set local role authenticated");
  try {
    const result = await db.query<T>(sql, params);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function shipment(org: string, barcode: string | null, status = "LABEL_READY") {
  const order = await db.query<{ id: string }>(
    `insert into public.orders (organization_id, order_number) values ($1, $2) returning id`,
    [org, `PB-${Math.random().toString(36).slice(2, 8)}`]
  );
  const row = await db.query<{ id: string }>(
    `insert into public.shipments (organization_id, order_id, weight_grams, barcode, status)
     values ($1, $2, 500, $3, $4) returning id`,
    [org, order.rows[0].id, barcode, status]
  );
  return row.rows[0].id;
}

async function statusOf(id: string) {
  const row = await db.query<{ status: string }>(`select status::text from public.shipments where id = $1`, [id]);
  return row.rows[0]?.status;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    create type public.shipment_status as enum (
      'DRAFT','VALIDATING','QUEUED','BOOKING','BOOKED','LABEL_PENDING','LABEL_READY',
      'MANIFEST_PENDING','MANIFEST_READY','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED',
      'FAILED','CANCELLED','RTO'
    );

    create table public.organizations (id uuid primary key default gen_random_uuid(), name text not null);
    create table public.organization_members (
      organization_id uuid not null references public.organizations(id) on delete cascade,
      user_id uuid not null,
      primary key (organization_id, user_id)
    );
    create or replace function public.is_org_member(org_id uuid)
    returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.organization_members m where m.organization_id = org_id and m.user_id = auth.uid());
    $$;

    create table public.orders (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id) on delete cascade,
      order_number text not null
    );
    create table public.shipments (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id) on delete cascade,
      order_id uuid not null references public.orders(id) on delete cascade,
      weight_grams integer not null,
      barcode text,
      status public.shipment_status not null default 'DRAFT',
      updated_at timestamptz not null default now()
    );
    create table public.manifests (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id) on delete cascade,
      pickup_location_id uuid,
      name text not null,
      status text not null default 'PENDING',
      file_path text,
      file_url text,
      shipment_count integer not null default 0,
      created_by uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.manifest_shipments (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id) on delete cascade,
      manifest_id uuid not null references public.manifests(id) on delete cascade,
      shipment_id uuid not null references public.shipments(id) on delete cascade,
      unique (manifest_id, shipment_id)
    );

    alter table public.shipments enable row level security;
    alter table public.manifests enable row level security;
    alter table public.manifest_shipments enable row level security;
    create policy shipments_tenant_all on public.shipments for all
      using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
    create policy manifests_tenant_all on public.manifests for all
      using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
    create policy manifest_shipments_tenant_all on public.manifest_shipments for all
      using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

    create role authenticated nologin;
    grant usage on schema public to authenticated;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant select, insert, update, delete on public.shipments, public.manifests, public.manifest_shipments to authenticated;
  `);

  const orgs = await db.query<{ id: string }>(
    `insert into public.organizations (name) values ('A'), ('B') returning id`
  );
  orgA = orgs.rows[0].id;
  orgB = orgs.rows[1].id;
  await db.query(`insert into public.organization_members values ($1, $2), ($3, $4)`, [orgA, USER_A, orgB, USER_B]);

  // Legacy data from the old daily regenerator: same shipment on two days.
  legacyShipment = await shipment(orgA, "EL000000001IN", "MANIFEST_READY");
  const old = await db.query<{ id: string }>(
    `insert into public.manifests (organization_id, name, status, shipment_count, created_at)
     values ($1, 'Manifest 2026-10-01', 'READY', 1, '2026-10-01T05:00:00Z') returning id`,
    [orgA]
  );
  const keep = await db.query<{ id: string }>(
    `insert into public.manifests (organization_id, name, status, shipment_count, created_at)
     values ($1, 'Manifest 2026-10-02', 'READY', 1, '2026-10-01T20:00:00Z') returning id`,
    [orgA]
  );
  legacyOld = old.rows[0].id;
  legacyKeep = keep.rows[0].id;
  await db.query(
    `insert into public.manifest_shipments (organization_id, manifest_id, shipment_id) values ($1, $2, $3), ($1, $4, $3)`,
    [orgA, legacyOld, legacyShipment, legacyKeep]
  );

  await db.exec(migration);
});

afterAll(async () => {
  await db.close();
});

describe("manifests lifecycle migration", () => {
  it("backfills legacy READY rows as CLOSED history with IST dates and keeps one link per shipment", async () => {
    const rows = await db.query<{ id: string; status: string; manifest_date: string; manifest_number: string; shipment_count: number }>(
      `select id, status, to_char(manifest_date, 'YYYY-MM-DD') as manifest_date, manifest_number, shipment_count
       from public.manifests where organization_id = $1 order by created_at`,
      [orgA]
    );
    expect(rows.rows.map((row) => row.status)).toEqual(["CLOSED", "CLOSED"]);
    // 2026-10-01T20:00Z is 2026-10-02 01:30 IST.
    expect(rows.rows.map((row) => row.manifest_date)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(rows.rows[0].manifest_number).toBe("MF-20261001-LEGACY-01");
    const links = await db.query<{ manifest_id: string }>(
      `select manifest_id from public.manifest_shipments where shipment_id = $1`,
      [legacyShipment]
    );
    expect(links.rows).toEqual([{ manifest_id: legacyKeep }]);
    expect(rows.rows.find((row) => row.id === legacyOld)?.shipment_count).toBe(0);
    expect(rows.rows.find((row) => row.id === legacyKeep)?.shipment_count).toBe(1);
  });

  it("rejects unknown statuses", async () => {
    await expect(
      db.query(`insert into public.manifests (organization_id, name, status) values ($1, 'x', 'READY')`, [orgA])
    ).rejects.toThrow(/manifests_status_chk/);
  });

  it("opens one draft per date and office and only adds eligible shipments", async () => {
    const a = await shipment(orgA, "EL000000010IN");
    const b = await shipment(orgA, "EL000000011IN", "BOOKED");
    const unbooked = await shipment(orgA, null, "DRAFT");
    const first = await asUser<{ manifest_id: string; shipment_id: string }>(
      USER_A,
      `select * from public.manifest_add_shipments($1, '2026-10-27', $2, 'Kolenchery SO', $3::uuid[], $4)`,
      [orgA, OFFICE, [a, unbooked], USER_A]
    );
    expect(first.rows.map((row) => row.shipment_id)).toEqual([a]);
    const second = await asUser<{ manifest_id: string; shipment_id: string }>(
      USER_A,
      `select * from public.manifest_add_shipments($1, '2026-10-27', $2, 'Kolenchery SO', $3::uuid[], $4)`,
      [orgA, OFFICE, [a, b], USER_A]
    );
    // a is already linked: only b is new, and it lands on the same draft.
    expect(second.rows.map((row) => row.shipment_id)).toEqual([b]);
    expect(second.rows[0].manifest_id).toBe(first.rows[0].manifest_id);

    const drafts = await db.query<{ shipment_count: number; office_name: string }>(
      `select shipment_count, office_name from public.manifests where organization_id = $1 and status = 'DRAFT'`,
      [orgA]
    );
    expect(drafts.rows).toEqual([{ shipment_count: 2, office_name: "Kolenchery SO" }]);
    expect(await statusOf(a)).toBe("MANIFEST_READY");
    expect(await statusOf(b)).toBe("MANIFEST_READY");
    expect(await statusOf(unbooked)).toBe("DRAFT");

    await expect(
      db.query(
        `insert into public.manifests (organization_id, name, status, manifest_date, office_id) values ($1, 'dup', 'DRAFT', '2026-10-27', $2)`,
        [orgA, OFFICE]
      )
    ).rejects.toThrow(/manifests_open_draft_uidx/);
  });

  it("keeps different offices and dates on separate drafts", async () => {
    const other = await shipment(orgA, "EL000000020IN");
    const nextDay = await shipment(orgA, "EL000000021IN");
    const officeRows = await db.query<{ manifest_id: string }>(
      `select * from public.manifest_add_shipments($1, '2026-10-27', '11111111', 'Other SO', $2::uuid[])`,
      [orgA, [other]]
    );
    const dayRows = await db.query<{ manifest_id: string }>(
      `select * from public.manifest_add_shipments($1, '2026-10-28', $2, 'Kolenchery SO', $3::uuid[])`,
      [orgA, OFFICE, [nextDay]]
    );
    const ids = new Set([officeRows.rows[0].manifest_id, dayRows.rows[0].manifest_id]);
    expect(ids.size).toBe(2);
  });

  it("removes from drafts, restoring the pre-manifest status", async () => {
    const booked = await shipment(orgA, "EL000000030IN", "BOOKED");
    const rows = await db.query<{ manifest_id: string }>(
      `select * from public.manifest_add_shipments($1, '2026-10-29', $2, null, $3::uuid[])`,
      [orgA, OFFICE, [booked]]
    );
    const manifestId = rows.rows[0].manifest_id;
    const removed = await db.query<{ manifest_remove_shipment: boolean }>(
      `select public.manifest_remove_shipment($1, $2)`,
      [manifestId, booked]
    );
    expect(removed.rows[0].manifest_remove_shipment).toBe(true);
    expect(await statusOf(booked)).toBe("BOOKED");
  });

  it("closes with a per-office sequence number, then locks edits", async () => {
    const draft = await db.query<{ id: string }>(
      `select id from public.manifests where organization_id = $1 and status = 'DRAFT' and manifest_date = '2026-10-27' and office_id = $2`,
      [orgA, OFFICE]
    );
    const manifestId = draft.rows[0].id;
    const closed = await asUser<{ status: string; manifest_number: string; closed_by: string }>(
      USER_A,
      `select status, manifest_number, closed_by from public.manifest_close($1, $2)`,
      [manifestId, USER_A]
    );
    expect(closed.rows[0]).toEqual({ status: "CLOSED", manifest_number: `MF-20261027-${OFFICE}-01`, closed_by: USER_A });

    const extra = await shipment(orgA, "EL000000040IN");
    await expect(
      db.query(`select * from public.manifest_add_to($1, $2::uuid[])`, [manifestId, [extra]])
    ).rejects.toThrow(/Only draft manifests/);
    const linked = await db.query<{ shipment_id: string }>(
      `select shipment_id from public.manifest_shipments where manifest_id = $1 limit 1`,
      [manifestId]
    );
    await expect(
      db.query(`select public.manifest_remove_shipment($1, $2)`, [manifestId, linked.rows[0].shipment_id])
    ).rejects.toThrow(/Only draft manifests/);
    await expect(db.query(`select * from public.manifest_close($1)`, [manifestId])).rejects.toThrow(/already closed/);

    // A second draft for the same date and office gets the next number.
    const later = await db.query<{ manifest_id: string }>(
      `select * from public.manifest_add_shipments($1, '2026-10-27', $2, 'Kolenchery SO', $3::uuid[])`,
      [orgA, OFFICE, [extra]]
    );
    expect(later.rows[0].manifest_id).not.toBe(manifestId);
    const next = await db.query<{ manifest_number: string }>(
      `select manifest_number from public.manifest_close($1)`,
      [later.rows[0].manifest_id]
    );
    expect(next.rows[0].manifest_number).toBe(`MF-20261027-${OFFICE}-02`);
  });

  it("refuses to close an empty draft", async () => {
    const empty = await db.query<{ id: string }>(
      `insert into public.manifests (organization_id, name, status, manifest_date, office_id) values ($1, 'empty', 'DRAFT', '2026-11-01', $2) returning id`,
      [orgA, OFFICE]
    );
    await expect(db.query(`select * from public.manifest_close($1)`, [empty.rows[0].id])).rejects.toThrow(
      /at least one shipment/
    );
  });

  it("reopens a closed manifest keeping its number, unless a draft is already open", async () => {
    const s = await shipment(orgA, "EL000000050IN");
    const added = await db.query<{ manifest_id: string }>(
      `select * from public.manifest_add_shipments($1, '2026-11-02', $2, null, $3::uuid[])`,
      [orgA, OFFICE, [s]]
    );
    const id = added.rows[0].manifest_id;
    const closed = await db.query<{ manifest_number: string }>(`select manifest_number from public.manifest_close($1)`, [id]);
    const reopened = await db.query<{ status: string; manifest_number: string }>(
      `select status, manifest_number from public.manifest_reopen($1)`,
      [id]
    );
    expect(reopened.rows[0]).toEqual({ status: "DRAFT", manifest_number: closed.rows[0].manifest_number });
    const again = await db.query<{ manifest_number: string }>(`select manifest_number from public.manifest_close($1)`, [id]);
    expect(again.rows[0].manifest_number).toBe(closed.rows[0].manifest_number);

    const s2 = await shipment(orgA, "EL000000051IN");
    await db.query(`select * from public.manifest_add_shipments($1, '2026-11-02', $2, null, $3::uuid[])`, [orgA, OFFICE, [s2]]);
    await expect(db.query(`select * from public.manifest_reopen($1)`, [id])).rejects.toThrow(/Another draft/);

    await db.query(`update public.manifests set status = 'HANDED_OVER' where id = $1`, [id]);
    await expect(db.query(`select * from public.manifest_reopen($1)`, [id])).rejects.toThrow(/Handed-over/);
  });

  it("keeps tenants isolated under RLS", async () => {
    const foreign = await shipment(orgA, "EL000000060IN");
    // Org B member cannot add org A shipments, even to its own draft.
    const rows = await asUser<{ shipment_id: string }>(
      USER_B,
      `select * from public.manifest_add_shipments($1, '2026-10-27', $2, null, $3::uuid[], $4)`,
      [orgB, OFFICE, [foreign], USER_B]
    );
    expect(rows.rows).toEqual([]);
    // Nor open a draft inside org A.
    await expect(
      asUser(USER_B, `select * from public.manifest_add_shipments($1, '2026-10-27', $2, null, $3::uuid[])`, [
        orgA,
        "99999999",
        [foreign],
      ])
    ).rejects.toThrow(/row-level security/);
    const visible = await asUser<{ count: number }>(
      USER_B,
      `select count(*)::int as count from public.manifests where organization_id = $1`,
      [orgA]
    );
    expect(visible.rows[0].count).toBe(0);
    // Org A member cannot close org B manifests (they are invisible, so "not found").
    const bDraft = await db.query<{ id: string }>(
      `select id from public.manifests where organization_id = $1 and status = 'DRAFT' limit 1`,
      [orgB]
    );
    await expect(asUser(USER_A, `select * from public.manifest_close($1)`, [bDraft.rows[0].id])).rejects.toThrow(
      /not found/
    );
  });
});
