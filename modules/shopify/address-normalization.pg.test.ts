/**
 * Isolated PGlite proof for 20261030143000_shopify_address_normalization.sql.
 * Does not use hosted Supabase or production.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261030143000_shopify_address_normalization.sql"),
  "utf8"
);

let db: PGlite;
let orgId: string;
let bookedAddressId: string;
let editedAddressId: string;
let legacyAddressId: string;
let bookedShipmentId: string;
let barcode: string;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table public.organizations (id uuid primary key default gen_random_uuid(), name text not null);
    create table public.customers (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      name text
    );
    create table public.addresses (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      customer_id uuid,
      kind text not null default 'shipping',
      name text,
      phone text,
      line1 text not null default '',
      line2 text,
      city text not null default '',
      state text not null default '',
      pincode text not null default '',
      country text not null default 'IN'
    );
    create table public.orders (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      shipping_address_id uuid,
      order_number text
    );
    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      action text not null,
      entity_type text,
      entity_id uuid
    );
    create table public.shipments (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      order_id uuid,
      status text,
      booked_at timestamptz,
      barcode text,
      tracking_number text
    );
  `);
  const org = await db.query<{ id: string }>("insert into public.organizations (name) values ('Staging Org') returning id");
  orgId = org.rows[0].id;
  const booked = await db.query<{ id: string }>(
    `insert into public.addresses (organization_id, line1, city, state, pincode, name, phone)
     values ($1, 'Booked House', 'Kozhikode', 'Kerala', '673001', 'Booked Person', '9876543210') returning id`,
    [orgId]
  );
  bookedAddressId = booked.rows[0].id;
  const edited = await db.query<{ id: string }>(
    `insert into public.addresses (organization_id, line1, city, state, pincode, name)
     values ($1, 'Merchant Corrected', 'Kalpetta', 'Kerala', '673121', 'Edited') returning id`,
    [orgId]
  );
  editedAddressId = edited.rows[0].id;
  const legacy = await db.query<{ id: string }>(
    `insert into public.addresses (organization_id, line1, city, state, pincode)
     values ($1, 'Unknown provenance', 'Mysuru', 'Karnataka', '570001') returning id`,
    [orgId]
  );
  legacyAddressId = legacy.rows[0].id;
  const bookedOrder = await db.query<{ id: string }>(
    `insert into public.orders (organization_id, shipping_address_id, order_number) values ($1, $2, '#B1') returning id`,
    [orgId, bookedAddressId]
  );
  const editedOrder = await db.query<{ id: string }>(
    `insert into public.orders (organization_id, shipping_address_id, order_number) values ($1, $2, '#E1') returning id`,
    [orgId, editedAddressId]
  );
  await db.query(
    `insert into public.audit_logs (organization_id, action, entity_type, entity_id)
     values ($1, 'order.shipping_address_updated', 'order', $2)`,
    [orgId, editedOrder.rows[0].id]
  );
  const shipment = await db.query<{ id: string; barcode: string }>(
    `insert into public.shipments (organization_id, order_id, status, booked_at, barcode, tracking_number)
     values ($1, $2, 'BOOKED', now(), 'ET214330016IN', 'ET214330016IN') returning id, barcode`,
    [orgId, bookedOrder.rows[0].id]
  );
  bookedShipmentId = shipment.rows[0].id;
  barcode = shipment.rows[0].barcode;

  await db.exec(migration);
});

afterAll(async () => {
  await db?.close();
});

describe("shopify address normalization migration (PGlite)", () => {
  it("adds tri-state override without rewriting booked shipping or barcodes", async () => {
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'addresses'
         and column_name in ('line3','original_shipping','address_validation_status','address_manual_override')`
    );
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual([
      "address_manual_override",
      "address_validation_status",
      "line3",
      "original_shipping",
    ]);

    const booked = await db.query<{ line1: string; address_manual_override: boolean | null; address_validation_status: string | null }>(
      "select line1, address_manual_override, address_validation_status from public.addresses where id = $1",
      [bookedAddressId]
    );
    expect(booked.rows[0].line1).toBe("Booked House");
    expect(booked.rows[0].address_validation_status).toBeNull();
    expect(booked.rows[0].address_manual_override).toBeNull();

    const edited = await db.query<{ line1: string; address_manual_override: boolean | null }>(
      "select line1, address_manual_override from public.addresses where id = $1",
      [editedAddressId]
    );
    expect(edited.rows[0].line1).toBe("Merchant Corrected");
    expect(edited.rows[0].address_manual_override).toBe(true);

    const legacy = await db.query<{ address_manual_override: boolean | null }>(
      "select address_manual_override from public.addresses where id = $1",
      [legacyAddressId]
    );
    expect(legacy.rows[0].address_manual_override).toBeNull();

    const shipment = await db.query<{ barcode: string; status: string }>(
      "select barcode, status from public.shipments where id = $1",
      [bookedShipmentId]
    );
    expect(shipment.rows[0].barcode).toBe(barcode);
    expect(shipment.rows[0].status).toBe("BOOKED");
  });

  it("is safe to apply twice", async () => {
    await db.exec(migration);
    const count = await db.query<{ n: number }>("select count(*)::int as n from public.addresses");
    expect(count.rows[0].n).toBe(3);
  });

  it("lets a new Shopify-managed insert default override to false", async () => {
    const inserted = await db.query<{ address_manual_override: boolean | null }>(
      `insert into public.addresses (organization_id, line1, city, state, pincode, original_shipping)
       values ($1, 'New import', 'Kozhikode', 'Kerala', '673001', '{}'::jsonb)
       returning address_manual_override`,
      [orgId]
    );
    expect(inserted.rows[0].address_manual_override).toBe(false);
  });
});
