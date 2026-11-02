import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;

const expireSql = `
update subscriptions
set status = 'EXPIRED'
where id = $1
  and organization_id = $2
  and status = $3
  and current_period_end = $4::timestamptz
  and current_period_end <= $5::timestamptz
returning id
`;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table subscriptions (
      id uuid primary key,
      organization_id uuid not null,
      status text not null,
      current_period_end timestamptz not null
    );
  `);
});

afterAll(async () => {
  await db?.close();
});

describe("billing expire predicate", () => {
  it("allows only one concurrent expiration for the same row", async () => {
    const id = crypto.randomUUID();
    const org = crypto.randomUUID();
    const ended = "2026-10-20T00:00:00.000Z";
    const now = "2026-10-30T00:00:00.000Z";
    await db.query("insert into subscriptions (id, organization_id, status, current_period_end) values ($1, $2, 'TRIAL', $3)", [
      id,
      org,
      ended,
    ]);
    const [a, b] = await Promise.all([
      db.query(expireSql, [id, org, "TRIAL", ended, now]),
      db.query(expireSql, [id, org, "TRIAL", ended, now]),
    ]);
    expect((a.rows?.length ?? 0) + (b.rows?.length ?? 0)).toBe(1);
    const row = await db.query<{ status: string }>("select status from subscriptions where id = $1", [id]);
    expect(row.rows[0]?.status).toBe("EXPIRED");
  });

  it("does not expire after a paid activation changes status", async () => {
    const id = crypto.randomUUID();
    const org = crypto.randomUUID();
    const ended = "2026-10-20T00:00:00.000Z";
    await db.query("insert into subscriptions (id, organization_id, status, current_period_end) values ($1, $2, 'ACTIVE', $3)", [
      id,
      org,
      "2026-11-30T00:00:00.000Z",
    ]);
    const result = await db.query(expireSql, [id, org, "TRIAL", ended, "2026-10-30T00:00:00.000Z"]);
    expect(result.rows).toHaveLength(0);
    const row = await db.query<{ status: string }>("select status from subscriptions where id = $1", [id]);
    expect(row.rows[0]?.status).toBe("ACTIVE");
  });

  it("does not expire after an admin extends current_period_end", async () => {
    const id = crypto.randomUUID();
    const org = crypto.randomUUID();
    const oldEnd = "2026-10-20T00:00:00.000Z";
    const newEnd = "2026-11-10T00:00:00.000Z";
    await db.query("insert into subscriptions (id, organization_id, status, current_period_end) values ($1, $2, 'TRIAL', $3)", [
      id,
      org,
      newEnd,
    ]);
    const result = await db.query(expireSql, [id, org, "TRIAL", oldEnd, "2026-10-30T00:00:00.000Z"]);
    expect(result.rows).toHaveLength(0);
    const row = await db.query<{ status: string; current_period_end: string }>(
      "select status, current_period_end::text from subscriptions where id = $1",
      [id]
    );
    expect(row.rows[0]?.status).toBe("TRIAL");
    expect(String(row.rows[0]?.current_period_end)).toContain("2026-11-10");
  });
});
