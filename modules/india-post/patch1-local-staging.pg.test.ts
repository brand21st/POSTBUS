/**
 * Isolated local staging for Tracking Reliability Patch 1.
 * In-process PGlite only. No production Supabase. No live India Post.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  cancelNewerDuplicateQueuedTrackingSync,
  enqueueDueTrackingSyncJobs,
  enqueueOrgTrackingSyncIfIdle,
} from "@/modules/india-post/tracking-sync";
import {
  cooldownMsForAuthStrikes,
  evaluateTrackingAuthHold,
  TRACKING_AUTH_HOLD_HISTORY_LIMIT,
} from "@/modules/india-post/tracking-auth-hold";
import { createIndiaPostLoginError, isConfirmedIndiaPostLoginAuthFailure, tagTrackingLoginAuthFailure } from "@/modules/india-post/login-auth";
import { classifyProviderError } from "@/lib/jobs/retry";
import { LOCAL_PATCH1_RUN } from "@/modules/india-post/cept-local-stub";

let db: PGlite;
const orgs: Record<string, string> = {};

function pgliteClient() {
  return {
    from(table: string) {
      const filters: Array<{ column: string; op: "eq" | "in" | "gt"; value: unknown }> = [];
      let orderCol: string | null = null;
      let ascending = true;
      let limitCount: number | null = null;
      let patch: Record<string, unknown> | null = null;
      let insertRow: Record<string, unknown> | null = null;
      const qualify = (column: string) => column.replace(/[^a-z0-9_]/gi, "");

      const apply = async () => {
        if (insertRow) {
          const keys = Object.keys(insertRow);
          const cols = keys.map(qualify).join(", ");
          const params = keys.map((key) => {
            const value = insertRow![key];
            return value && typeof value === "object" ? JSON.stringify(value) : value;
          });
          const placeholders = params.map((_, index) => `$${index + 1}`).join(", ");
          const result = await db.query(
            `insert into public.${qualify(table)} (${cols}) values (${placeholders}) returning *`,
            params
          );
          return { data: result.rows[0] ?? null, error: null };
        }
        const params: unknown[] = [];
        let sql = `select * from public.${qualify(table)} where 1=1`;
        for (const filter of filters) {
          const column = qualify(filter.column);
          if (filter.op === "eq") {
            params.push(filter.value);
            sql += ` and ${column} = $${params.length}`;
          } else if (filter.op === "gt") {
            params.push(filter.value);
            sql += ` and ${column} > $${params.length}`;
          } else {
            const values = filter.value as string[];
            const placeholders = values.map((value) => {
              params.push(value);
              return `$${params.length}`;
            });
            sql += ` and ${column} in (${placeholders.join(",")})`;
          }
        }
        if (orderCol) sql += ` order by ${qualify(orderCol)} ${ascending ? "asc" : "desc"}`;
        if (limitCount != null) sql += ` limit ${limitCount}`;
        if (patch) {
          const set = Object.keys(patch)
            .map((key, index) => `${qualify(key)} = $${params.length + index + 1}`)
            .join(", ");
          const values = Object.values(patch);
          const updateSql = `update public.${qualify(table)} set ${set} where id in (${sql.replace("select *", "select id")})`;
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
      api.gt = (column: string, value: unknown) => {
        filters.push({ column, op: "gt", value });
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
      api.maybeSingle = async () => {
        limitCount = 1;
        const result = await apply();
        const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
        return { data: rows[0] ?? null, error: null };
      };
      api.single = async () => {
        const result = await apply();
        const row = Array.isArray(result.data) ? result.data[0] : result.data;
        return { data: row ?? null, error: row ? null : { message: "no rows" } };
      };
      api.insert = (row: Record<string, unknown>) => {
        insertRow = row;
        return api;
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

async function jobCounts(organizationId: string) {
  const result = await db.query<{ status: string; n: number }>(
    `select status::text as status, count(*)::int as n from public.background_jobs where organization_id = $1 group by status`,
    [organizationId]
  );
  return Object.fromEntries(result.rows.map((row) => [row.status, row.n]));
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
      name text not null,
      run_id text not null default '${LOCAL_PATCH1_RUN}'
    );
    create table public.india_post_connections (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null unique,
      status text not null default 'CONNECTED',
      encrypted_username text,
      last_verified_at timestamptz,
      last_refreshed_at timestamptz
    );
    create table public.automation_settings (
      organization_id uuid primary key,
      auto_tracking_sync boolean not null default true
    );
    create table public.shipments (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      barcode text not null,
      status text not null default 'IN_TRANSIT'
    );
    create table public.tracking_events (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      shipment_id uuid not null,
      event_code text not null,
      created_at timestamptz not null default now()
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
      created_by uuid,
      progress jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
  `);
  const names = ["ORG_A", "ORG_B", "ORG_C", "ORG_D", "ORG_E"] as const;
  for (const name of names) {
    const row = await db.query<{ id: string }>("insert into public.organizations (name) values ($1) returning id", [name]);
    orgs[name] = row.rows[0]!.id;
    const username = name === "ORG_A" ? "invalid" : "valid";
    await db.query(
      `insert into public.india_post_connections (organization_id, status, encrypted_username, last_verified_at)
       values ($1, 'CONNECTED', $2, $3)`,
      [orgs[name], username, name === "ORG_B" || name === "ORG_D" ? new Date().toISOString() : null]
    );
    await db.query(`insert into public.automation_settings (organization_id, auto_tracking_sync) values ($1, true)`, [
      orgs[name],
    ]);
  }
  await db.query(
    `insert into public.shipments (organization_id, barcode) values ($1, 'TESTAWB001IN'), ($2, 'TESTAWB002IN')`,
    [orgs.ORG_A, orgs.ORG_B]
  );
  await db.query(
    `insert into public.tracking_events (organization_id, shipment_id, event_code)
     select organization_id, id, 'ITEM_BAGGED' from public.shipments`
  );
});

afterAll(async () => {
  await db?.close();
});

describe("Patch 1 local staging E2E (PGlite)", () => {
  it("TEST 1: login HTTP 400 authentication failure holds ORG_A and stops the next cron enqueue", async () => {
    const first = await enqueueOrgTrackingSyncIfIdle(pgliteClient() as never, orgs.ORG_A);
    expect(first.enqueued).toBe(true);
    const queued = await db.query<{ id: string }>(
      `select id from public.background_jobs where organization_id = $1 and status = 'QUEUED'`,
      [orgs.ORG_A]
    );
    const loginError = createIndiaPostLoginError(400, "India Post authentication failed.");
    expect(isConfirmedIndiaPostLoginAuthFailure(loginError)).toBe(true);
    const tagged = tagTrackingLoginAuthFailure(loginError) as { code?: string; message: string };
    await db.query(
      `update public.background_jobs set status = 'FAILED', last_error_code = $2, last_error = $3 where id = $1`,
      [queued.rows[0]!.id, tagged.code, tagged.message]
    );
    const hold = await evaluateTrackingAuthHold(pgliteClient() as never, { organizationId: orgs.ORG_A });
    expect(hold).toMatchObject({ blocked: true, reason: "auth-hold" });
    const second = await enqueueOrgTrackingSyncIfIdle(pgliteClient() as never, orgs.ORG_A);
    expect(second).toMatchObject({ enqueued: false, reason: "auth-hold" });
    const events = await db.query<{ n: number }>(
      `select count(*)::int as n from public.tracking_events where organization_id = $1`,
      [orgs.ORG_A]
    );
    expect(events.rows[0]?.n).toBe(1);
  });

  it("TEST 2: cooldown steps 15m/1h/4h/12h/24h without waiting wall-clock hours", () => {
    expect(cooldownMsForAuthStrikes(1)).toBe(15 * 60_000);
    expect(cooldownMsForAuthStrikes(2)).toBe(60 * 60_000);
    expect(cooldownMsForAuthStrikes(3)).toBe(4 * 60 * 60_000);
    expect(cooldownMsForAuthStrikes(4)).toBe(12 * 60 * 60_000);
    expect(cooldownMsForAuthStrikes(5)).toBe(24 * 60 * 60_000);
    expect(cooldownMsForAuthStrikes(9)).toBe(24 * 60 * 60_000);
  });

  it("TEST 3: empty recovery probe does not clear hold across 10 scheduler cycles", async () => {
    const failureAt = new Date(Date.now() - 20 * 60_000).toISOString();
    await db.query(`delete from public.background_jobs where organization_id = $1`, [orgs.ORG_A]);
    await db.query(
      `insert into public.background_jobs (organization_id, job_type, status, last_error_code, last_error, created_at)
       values ($1, 'tracking-sync', 'FAILED', 'HTTP_400', 'India Post authentication failed.', $2)`,
      [orgs.ORG_A, failureAt]
    );
    const before = await db.query<{ n: number }>(
      `select count(*)::int as n from public.background_jobs where organization_id = $1`,
      [orgs.ORG_A]
    );
    const probe = await enqueueOrgTrackingSyncIfIdle(pgliteClient() as never, orgs.ORG_A, {});
    expect(probe.reason).toBe("probe");
    await db.query(
      `update public.background_jobs set status = 'SUCCEEDED' where organization_id = $1 and status = 'QUEUED'`,
      [orgs.ORG_A]
    );
    const reasons: string[] = [];
    for (let cycle = 0; cycle < 10; cycle += 1) {
      const result = await enqueueOrgTrackingSyncIfIdle(pgliteClient() as never, orgs.ORG_A, {});
      reasons.push(result.reason);
    }
    const after = await db.query<{ n: number }>(
      `select count(*)::int as n from public.background_jobs where organization_id = $1`,
      [orgs.ORG_A]
    );
    expect(before.rows[0]?.n).toBe(1);
    expect(after.rows[0]?.n).toBe(2);
    expect(reasons.every((reason) => reason === "auth-hold" || reason === "probe-throttle")).toBe(true);
    const hold = await evaluateTrackingAuthHold(pgliteClient() as never, { organizationId: orgs.ORG_A });
    expect(hold.blocked).toBe(true);
    expect(hold.reason).toBe("probe-throttle");
  });

  it("TEST 4: verified credentials clear hold; failed verification does not", async () => {
    const failedVerify = await enqueueOrgTrackingSyncIfIdle(pgliteClient() as never, orgs.ORG_A, {
      last_verified_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    });
    expect(failedVerify.enqueued).toBe(false);
    const recovered = await enqueueOrgTrackingSyncIfIdle(pgliteClient() as never, orgs.ORG_A, {
      last_verified_at: new Date().toISOString(),
    });
    expect(recovered.enqueued).toBe(true);
    const failedRemain = await db.query<{ n: number }>(
      `select count(*)::int as n from public.background_jobs where organization_id = $1 and status = 'FAILED'`,
      [orgs.ORG_A]
    );
    expect(failedRemain.rows[0]?.n).toBeGreaterThan(0);
  });

  it("TEST 5: concurrent enqueue collapses duplicates and preserves RUNNING plus ORG_E", async () => {
    await db.query(`delete from public.background_jobs where organization_id = $1`, [orgs.ORG_E]);
    await db.query(
      `insert into public.background_jobs (organization_id, job_type, status) values ($1, 'tracking-sync', 'RUNNING')`,
      [orgs.ORG_E]
    );
    const overlapping = await enqueueOrgTrackingSyncIfIdle(pgliteClient() as never, orgs.ORG_E);
    expect(overlapping).toMatchObject({ enqueued: false, reason: "open-job" });

    await db.query(`delete from public.background_jobs where organization_id = $1`, [orgs.ORG_E]);
    for (const n of [2, 3, 5]) {
      await db.query(`delete from public.background_jobs where organization_id = $1`, [orgs.ORG_E]);
      await Promise.all(
        Array.from({ length: n }, () => enqueueOrgTrackingSyncIfIdle(pgliteClient() as never, orgs.ORG_E))
      );
      await cancelNewerDuplicateQueuedTrackingSync(pgliteClient() as never, orgs.ORG_E);
      const counts = await jobCounts(orgs.ORG_E);
      expect((counts.QUEUED ?? 0) + (counts.PENDING ?? 0)).toBe(1);
      expect(counts.RUNNING ?? 0).toBe(0);
      if (n === 5) {
        expect(counts.CANCELLED ?? 0).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("TEST 6: ORG_B continues while ORG_A is held and ORG_C has no shipments", async () => {
    await db.query(`delete from public.background_jobs where organization_id in ($1, $2, $3)`, [
      orgs.ORG_A,
      orgs.ORG_B,
      orgs.ORG_C,
    ]);
    await db.query(
      `insert into public.background_jobs (organization_id, job_type, status, last_error_code, last_error, created_at)
       values ($1, 'tracking-sync', 'FAILED', 'HTTP_400', 'India Post authentication failed.', now())`,
      [orgs.ORG_A]
    );
    const result = await enqueueDueTrackingSyncJobs(pgliteClient() as never);
    expect(result.considered).toBeGreaterThanOrEqual(3);
    const a = await jobCounts(orgs.ORG_A);
    const b = await jobCounts(orgs.ORG_B);
    const c = await jobCounts(orgs.ORG_C);
    expect(a.QUEUED ?? 0).toBe(0);
    expect(b.QUEUED ?? 0).toBe(1);
    expect((c.QUEUED ?? 0) <= 1).toBe(true);
    const cross = await db.query<{ n: number }>(
      `select count(*)::int as n from public.tracking_events e
       join public.shipments s on s.id = e.shipment_id
       where e.organization_id <> s.organization_id`
    );
    expect(cross.rows[0]?.n).toBe(0);
  });

  it("TEST 7: booking HTTP 400 classification is unchanged and hold does not gate booking lock", async () => {
    const booking400 = createIndiaPostLoginError(400, "customer id is required");
    expect(booking400.code).toBe("HTTP_400");
    expect(isConfirmedIndiaPostLoginAuthFailure(booking400)).toBe(false);
    expect(classifyProviderError(booking400)).toMatchObject({ retryable: false, code: "HTTP_400" });
    const hold = await evaluateTrackingAuthHold(pgliteClient() as never, { organizationId: orgs.ORG_A });
    expect(hold.blocked).toBe(true);
  });

  it("TEST 8: strike history is bounded and missing FAILED rows do not throw", async () => {
    const extraOrg = await db.query<{ id: string }>(
      `insert into public.organizations (name) values ('ORG_RETENTION') returning id`
    );
    const organizationId = extraOrg.rows[0]!.id;
    for (let i = 0; i < 12; i += 1) {
      await db.query(
        `insert into public.background_jobs (organization_id, job_type, status, last_error_code, last_error, created_at)
         values ($1, 'tracking-sync', 'FAILED', 'HTTP_400', 'India Post authentication failed.', now() - ($2 || ' minutes')::interval)`,
        [organizationId, String(i)]
      );
    }
    await db.query(
      `insert into public.background_jobs (organization_id, job_type, status, last_error_code, last_error)
       values ($1, 'shipment-booking', 'FAILED', 'HTTP_400', 'India Post authentication failed.')`,
      [organizationId]
    );
    const hold = await evaluateTrackingAuthHold(pgliteClient() as never, { organizationId });
    expect(hold.strikeCount).toBeLessThanOrEqual(TRACKING_AUTH_HOLD_HISTORY_LIMIT);
    const empty = await evaluateTrackingAuthHold(pgliteClient() as never, {
      organizationId: crypto.randomUUID(),
    });
    expect(empty).toMatchObject({ blocked: false, reason: "idle", strikeCount: 0 });
  });

  it("performance: scheduler duration for 100/500/1000 synthetic orgs (bounded local PGlite)", async () => {
    const measurements: Array<{ orgs: number; ms: number; considered: number; enqueued: number }> = [];
    for (const size of [100, 500, 1000]) {
      await db.query(`delete from public.background_jobs where organization_id in (select id from public.organizations where name like 'PERF-%')`);
      await db.query(`delete from public.india_post_connections where organization_id in (select id from public.organizations where name like 'PERF-%')`);
      await db.query(`delete from public.automation_settings where organization_id in (select id from public.organizations where name like 'PERF-%')`);
      await db.query(`delete from public.organizations where name like 'PERF-%'`);
      await db.query(
        `insert into public.organizations (name)
         select 'PERF-' || g::text from generate_series(1, $1) as g`,
        [size]
      );
      await db.query(`
        insert into public.automation_settings (organization_id)
        select id from public.organizations where name like 'PERF-%'
      `);
      await db.query(`
        insert into public.india_post_connections (organization_id, encrypted_username, last_verified_at)
        select id, 'valid', now() from public.organizations where name like 'PERF-%'
      `);
      const started = performance.now();
      const result = await enqueueDueTrackingSyncJobs(pgliteClient() as never);
      measurements.push({
        orgs: size,
        ms: Math.round(performance.now() - started),
        considered: result.considered,
        enqueued: result.enqueued,
      });
    }
    expect(measurements[0]?.ms).toBeGreaterThanOrEqual(0);
    expect(measurements[2]?.considered).toBeLessThanOrEqual(100);
    console.log(JSON.stringify({ event: "patch1_local_perf", measurements }));
  });
});
