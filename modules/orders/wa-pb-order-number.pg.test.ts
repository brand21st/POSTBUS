/**
 * Real PostgreSQL allocation for WA-PB-##### (WhatsApp/storefront order ids).
 * Run: npx vitest run modules/orders/wa-pb-order-number.pg.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const waSql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261008161000_next_wa_pb_order_number.sql"),
  "utf8"
);
const pbSql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261008103000_next_pb_order_number_lock.sql"),
  "utf8"
);

let db: PGlite;
let orgA: string;
let orgB: string;

function withoutGrants(sql: string) {
  return sql
    .split("\n")
    .filter((line) => !/^\s*(revoke|grant)\b/i.test(line))
    .join("\n");
}

async function nextWa(organizationId: string) {
  const result = await db.query<{ next_wa_pb_order_number: string }>(
    "select public.next_wa_pb_order_number($1::uuid) as next_wa_pb_order_number",
    [organizationId]
  );
  return result.rows[0]!.next_wa_pb_order_number;
}

async function nextPb(organizationId: string) {
  const result = await db.query<{ next_pb_order_number: string }>(
    "select public.next_pb_order_number($1::uuid) as next_pb_order_number",
    [organizationId]
  );
  return result.rows[0]!.next_pb_order_number;
}

async function insertOrder(organizationId: string, orderNumber: string) {
  await db.query("insert into public.orders (organization_id, order_number) values ($1::uuid, $2)", [
    organizationId,
    orderNumber,
  ]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table public.orders (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      order_number text not null
    );
    create unique index orders_org_number_idx on public.orders (organization_id, order_number);
  `);
  await db.exec(withoutGrants(pbSql));
  await db.exec(withoutGrants(waSql));
  orgA = (await db.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
  orgB = (await db.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
});

afterAll(async () => {
  await db?.close();
});

describe("next_wa_pb_order_number", () => {
  it("starts at WA-PB-10001 when the org has no WhatsApp sequence", async () => {
    expect(await nextWa(orgA)).toBe("WA-PB-10001");
  });

  it("ignores dashboard PB-##### rows and hashed Shopify-style ids", async () => {
    await insertOrder(orgA, "PB-10999");
    await insertOrder(orgA, "#1042");
    await insertOrder(orgA, "PB-BROWSER-TEST");
    expect(await nextWa(orgA)).toBe("WA-PB-10001");
    expect(await nextPb(orgA)).toBe("PB-11000");
  });

  it("increments only WA-PB sequence numbers, including stray hashed values", async () => {
    await insertOrder(orgA, "WA-PB-10016");
    await insertOrder(orgA, "#WA-PB-10001");
    expect(await nextWa(orgA)).toBe("WA-PB-10017");
  });

  it("isolates sequences per organization", async () => {
    expect(await nextWa(orgB)).toBe("WA-PB-10001");
    await insertOrder(orgB, "WA-PB-10001");
    expect(await nextWa(orgB)).toBe("WA-PB-10002");
    expect(await nextWa(orgA)).toBe("WA-PB-10017");
  });

  it("allows PB-10001 and WA-PB-10001 on the same org unique index", async () => {
    const orgC = (await db.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
    await insertOrder(orgC, "PB-10001");
    await insertOrder(orgC, "WA-PB-10001");
    const duplicate = db.query(
      "insert into public.orders (organization_id, order_number) values ($1::uuid, $2)",
      [orgC, "WA-PB-10001"]
    );
    await expect(duplicate).rejects.toThrow();
    expect(await nextWa(orgC)).toBe("WA-PB-10002");
    expect(await nextPb(orgC)).toBe("PB-10002");
  });
});
