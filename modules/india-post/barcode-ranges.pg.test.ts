/**
 * Real PostgreSQL proof for two active India Post barcode series.
 * Uses in-process PGlite, not a mocked query builder.
 *
 * Run: npx vitest run modules/india-post/barcode-ranges.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table public.organizations (
      id uuid primary key default gen_random_uuid(),
      name text not null default 'org'
    );
    create table public.barcode_ranges (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id) on delete cascade,
      service_code text,
      prefix text not null,
      suffix text not null default 'IN',
      start_number bigint not null,
      end_number bigint not null,
      next_number bigint not null,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index barcode_ranges_active_service_uidx
      on public.barcode_ranges (organization_id, coalesce(service_code, ''))
      where is_active;
  `);
  await db.exec(`
    create or replace function public.allocate_barcode_serial(p_range_id uuid)
    returns table (prefix text, serial bigint, suffix text)
    language plpgsql
    as $$
    declare
      current_next bigint;
      current_end bigint;
      current_prefix text;
      current_suffix text;
    begin
      select barcode_ranges.prefix, barcode_ranges.suffix, barcode_ranges.next_number, barcode_ranges.end_number
        into current_prefix, current_suffix, current_next, current_end
      from public.barcode_ranges
      where id = p_range_id
      for update;
      if current_prefix is null then
        raise exception 'Barcode range not found';
      end if;
      if current_next > current_end then
        raise exception 'Barcode range exhausted';
      end if;
      update public.barcode_ranges
        set next_number = current_next + 1, updated_at = now()
        where id = p_range_id;
      prefix := current_prefix;
      serial := current_next;
      suffix := current_suffix;
      return next;
    end;
    $$;
  `);
});

afterAll(async () => {
  await db.close();
});

describe("barcode_ranges database", () => {
  it("stores Speed Post and Parcel Contractual series with suffix IN", async () => {
    const org = await db.query<{ id: string }>(
      "insert into public.organizations (name) values ('Barcode org') returning id"
    );
    const organizationId = org.rows[0].id;

    await db.query(
      `insert into public.barcode_ranges
        (organization_id, service_code, prefix, start_number, end_number, next_number)
       values
        ($1, 'SP_INLAND_PARCEL', 'EY', 100, 110, 100),
        ($1, 'BUSINESS_PARCEL', 'CL', 200, 210, 200)`,
      [organizationId]
    );

    const rows = await db.query<{ service_code: string; prefix: string; suffix: string }>(
      `select service_code, prefix, suffix
       from public.barcode_ranges
       where organization_id = $1 and is_active
       order by service_code`,
      [organizationId]
    );
    expect(rows.rows).toEqual([
      { service_code: "BUSINESS_PARCEL", prefix: "CL", suffix: "IN" },
      { service_code: "SP_INLAND_PARCEL", prefix: "EY", suffix: "IN" },
    ]);
  });

  it("rejects a second active series for the same service", async () => {
    const org = await db.query<{ id: string }>(
      "insert into public.organizations (name) values ('Duplicate org') returning id"
    );
    const organizationId = org.rows[0].id;
    await db.query(
      `insert into public.barcode_ranges
        (organization_id, service_code, prefix, start_number, end_number, next_number)
       values ($1, 'BUSINESS_PARCEL', 'CX', 1, 10, 1)`,
      [organizationId]
    );
    await expect(
      db.query(
        `insert into public.barcode_ranges
          (organization_id, service_code, prefix, start_number, end_number, next_number)
         values ($1, 'BUSINESS_PARCEL', 'CL', 11, 20, 11)`,
        [organizationId]
      )
    ).rejects.toThrow(/barcode_ranges_active_service_uidx/);
  });

  it("allocates from one series without moving the other", async () => {
    const org = await db.query<{ id: string }>(
      "insert into public.organizations (name) values ('Allocate org') returning id"
    );
    const organizationId = org.rows[0].id;
    const inserted = await db.query<{ id: string; prefix: string }>(
      `insert into public.barcode_ranges
        (organization_id, service_code, prefix, start_number, end_number, next_number)
       values
        ($1, 'SP_INLAND_PARCEL', 'EL', 50, 52, 50),
        ($1, 'BUSINESS_PARCEL', 'CX', 80, 82, 80)
       returning id, prefix`,
      [organizationId]
    );
    const speed = inserted.rows.find((row) => row.prefix === "EL");
    const allocated = await db.query<{ prefix: string; serial: string; suffix: string }>(
      "select * from public.allocate_barcode_serial($1::uuid)",
      [speed?.id]
    );
    expect(allocated.rows[0]).toMatchObject({ prefix: "EL", suffix: "IN" });
    expect(Number(allocated.rows[0].serial)).toBe(50);

    const next = await db.query<{ prefix: string; next_number: string }>(
      `select prefix, next_number::text
       from public.barcode_ranges
       where organization_id = $1
       order by prefix`,
      [organizationId]
    );
    expect(next.rows).toEqual([
      { prefix: "CX", next_number: "80" },
      { prefix: "EL", next_number: "51" },
    ]);
  });
});
