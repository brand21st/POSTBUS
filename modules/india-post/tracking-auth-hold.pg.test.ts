/**
 * Isolated PGlite proof that tracking-sync inserts are not unique,
 * and that cancelNewerDuplicateQueuedTrackingSync keeps one QUEUED row.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { cancelNewerDuplicateQueuedTrackingSync } from "@/modules/india-post/tracking-sync";

let db: PGlite;
let orgA: string;
let orgB: string;

function pgliteJobsClient() {
  return {
    from(table: string) {
      if (table !== "background_jobs") {
        throw new Error(`unexpected table ${table}`);
      }
      const filters: Array<{ column: string; op: "eq" | "in"; value: unknown }> = [];
      let orderCol = "created_at";
      let ascending = true;
      let limitCount = 50;
      let patch: Record<string, unknown> | null = null;
      const apply = async () => {
        let sql = "select * from public.background_jobs where 1=1";
        const params: unknown[] = [];
        for (const filter of filters) {
          if (filter.op === "eq") {
            params.push(filter.value);
            sql += ` and ${filter.column} = $${params.length}`;
          } else {
            const values = filter.value as string[];
            const placeholders = values.map((value) => {
              params.push(value);
              return `$${params.length}`;
            });
            sql += ` and ${filter.column} in (${placeholders.join(",")})`;
          }
        }
        sql += ` order by ${orderCol} ${ascending ? "asc" : "desc"} limit ${limitCount}`;
        if (patch) {
          const set = Object.keys(patch)
            .map((key, index) => `${key} = $${params.length + index + 1}`)
            .join(", ");
          const values = Object.values(patch);
          const updateSql = `update public.background_jobs set ${set} where id in (${sql.replace("select *", "select id")})`;
          await db.query(updateSql, [...params, ...values]);
          return { data: null, error: null };
        }
        const result = await db.query(sql, params);
        return { data: result.rows, error: null };
      };
      const api: Record<string, unknown> = {};
      api.select = () => api;
      api.eq = (column: string, value: unknown) => {
        filters.push({ column, op: "eq", value });
        return api;
      };
      api.in = (column: string, value: unknown) => {
        filters.push({ column, op: "in", value });
        return api;
      };
      api.order = (column: string, opts?: { ascending?: boolean }) => {
        orderCol = column;
        ascending = Boolean(opts?.ascending);
        return api;
      };
      api.limit = (count: number) => {
        limitCount = count;
        return apply();
      };
      api.update = (next: Record<string, unknown>) => {
        patch = next;
        return api;
      };
      api.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        apply().then(resolve, reject);
      return api;
    },
  };
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    do $$ begin
      create type public.job_status as enum ('PENDING','QUEUED','RUNNING','RETRYING','SUCCEEDED','FAILED','CANCELLED');
    exception when duplicate_object then null;
    end $$;
    create table public.organizations (
      id uuid primary key default gen_random_uuid(),
      name text not null default 'org'
    );
    create table public.background_jobs (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      job_type text not null,
      entity_type text,
      entity_id uuid,
      status public.job_status not null default 'QUEUED',
      last_error text,
      last_error_code text,
      created_at timestamptz not null default now()
    );
  `);
  const orgs = await db.query<{ id: string }>(
    "insert into public.organizations (name) values ('A'), ('B') returning id"
  );
  orgA = orgs.rows[0]!.id;
  orgB = orgs.rows[1]!.id;
});

afterAll(async () => {
  await db?.close();
});

describe("tracking-sync enqueue uniqueness (PGlite)", () => {
  it("allows two concurrent inserts without a unique constraint", async () => {
    await Promise.all([
      db.query(
        "insert into public.background_jobs (organization_id, job_type, status) values ($1, 'tracking-sync', 'QUEUED')",
        [orgA]
      ),
      db.query(
        "insert into public.background_jobs (organization_id, job_type, status) values ($1, 'tracking-sync', 'QUEUED')",
        [orgA]
      ),
    ]);
    const count = await db.query<{ n: number }>(
      "select count(*)::int as n from public.background_jobs where organization_id = $1 and status = 'QUEUED'",
      [orgA]
    );
    expect(count.rows[0]?.n).toBe(2);
  });

  it("cancels newer duplicate queued jobs for one organization only", async () => {
    await db.query(
      "insert into public.background_jobs (organization_id, job_type, status) values ($1, 'tracking-sync', 'QUEUED')",
      [orgB]
    );
    const result = await cancelNewerDuplicateQueuedTrackingSync(pgliteJobsClient() as never, orgA);
    expect(result.cancelled).toBeGreaterThanOrEqual(1);
    const remainingA = await db.query<{ n: number }>(
      "select count(*)::int as n from public.background_jobs where organization_id = $1 and status = 'QUEUED'",
      [orgA]
    );
    const remainingB = await db.query<{ n: number }>(
      "select count(*)::int as n from public.background_jobs where organization_id = $1 and status = 'QUEUED'",
      [orgB]
    );
    expect(remainingA.rows[0]?.n).toBe(1);
    expect(remainingB.rows[0]?.n).toBe(1);
  });

  it("collapses five concurrent queued inserts to one queued job", async () => {
    await db.query("delete from public.background_jobs where organization_id = $1", [orgA]);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        db.query(
          "insert into public.background_jobs (organization_id, job_type, status) values ($1, 'tracking-sync', 'QUEUED')",
          [orgA]
        )
      )
    );
    const before = await db.query<{ n: number }>(
      "select count(*)::int as n from public.background_jobs where organization_id = $1 and status = 'QUEUED'",
      [orgA]
    );
    expect(before.rows[0]?.n).toBe(5);
    const result = await cancelNewerDuplicateQueuedTrackingSync(pgliteJobsClient() as never, orgA);
    expect(result.cancelled).toBe(4);
    const after = await db.query<{ n: number; c: number }>(
      `select
         count(*) filter (where status = 'QUEUED')::int as n,
         count(*) filter (where status = 'CANCELLED')::int as c
       from public.background_jobs where organization_id = $1`,
      [orgA]
    );
    expect(after.rows[0]?.n).toBe(1);
    expect(after.rows[0]?.c).toBe(4);
  });
});
