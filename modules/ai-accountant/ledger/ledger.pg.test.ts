/**
 * Postgres proof for the AI Accountant ledger migration: atomic idempotent posting,
 * balance enforcement, immutability, question quota and tenant RLS.
 * Run: npx vitest run modules/ai-accountant/ledger/ledger.pg.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEFAULT_CHART } from "@/modules/ai-accountant/chart";

const migration = (name: string) => readFileSync(path.join(process.cwd(), "supabase/migrations", name), "utf8");

let db: PGlite;
let orgA: string;
let orgB: string;
const OWNER = "00000000-0000-0000-0000-0000000000a1";
const VIEWER = "00000000-0000-0000-0000-0000000000a2";
const OUTSIDER = "00000000-0000-0000-0000-0000000000b1";

async function post(org: string, entry: Record<string, unknown>, lines: Array<Record<string, unknown>>) {
  const result = await db.query<{ id: string }>("select public.accounting_post_entry($1::uuid, $2::jsonb, $3::jsonb) as id", [
    org,
    JSON.stringify(entry),
    JSON.stringify(lines),
  ]);
  return result.rows[0]!.id;
}

async function asUser<T>(uid: string, fn: () => Promise<T>) {
  await db.exec(`set role authenticated; select set_config('test.uid', '${uid}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
    do $$ begin create role anon; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role; exception when duplicate_object then null; end $$;
    grant usage on schema public to authenticated;
    create type public.member_role as enum ('OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER');
    create table public.organizations (id uuid primary key default gen_random_uuid(), name text not null default 'org');
    create table public.organization_members (organization_id uuid, user_id uuid, role public.member_role);
    grant select on public.organization_members to authenticated;
    create function public.current_test_uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function public.is_org_member(org_id uuid) returns boolean language sql stable security definer as $$
      select exists (select 1 from public.organization_members m where m.organization_id = org_id and m.user_id = public.current_test_uid()) $$;
    create function public.has_org_role(org_id uuid, roles public.member_role[]) returns boolean language sql stable security definer as $$
      select exists (select 1 from public.organization_members m where m.organization_id = org_id and m.user_id = public.current_test_uid() and m.role = any(roles)) $$;
    create function public.is_platform_admin() returns boolean language sql stable as $$ select false $$;
    create table public.products (id uuid primary key default gen_random_uuid(), organization_id uuid);
    create table public.orders (id uuid primary key default gen_random_uuid(), organization_id uuid);
    create table public.shipments (id uuid primary key default gen_random_uuid(), organization_id uuid, barcode text);
    create table public.payments (id uuid primary key default gen_random_uuid(), organization_id uuid, billing_cycle text, created_at timestamptz default now());
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  `);
  await db.exec(migration("20261019120000_paid_addons_ai_accountant.sql"));
  await db.exec(migration("20261026120000_ai_accountant_full.sql"));
  const orgs = await db.query<{ id: string }>("insert into public.organizations (name) values ('a'), ('b') returning id");
  orgA = orgs.rows[0]!.id;
  orgB = orgs.rows[1]!.id;
  await db.query(
    "insert into public.organization_members values ($1, $2, 'OWNER'), ($1, $3, 'VIEWER'), ($4, $5, 'OWNER')",
    [orgA, OWNER, VIEWER, orgB, OUTSIDER]
  );
  for (const org of [orgA, orgB]) {
    for (const account of DEFAULT_CHART) {
      await db.query(
        "insert into public.ledger_accounts (organization_id, code, name, type, system_key, is_system) values ($1, $2, $3, $4, $5, true)",
        [org, account.code, account.name, account.type, account.key]
      );
    }
  }
});

afterAll(async () => {
  await db?.close();
});

const sale = { source_type: "order", source_id: "11111111-1111-1111-1111-111111111111", source_event: "sale", memo: "Sale", entry_date: "2026-10-05" };
const saleLines = [
  { account_key: "cod_receivable", debit_paise: 11800 },
  { account_key: "sales", credit_paise: 10000 },
  { account_key: "gst_output_igst", credit_paise: 1800, gst_component: "IGST" },
];

describe("accounting_post_entry", () => {
  it("posts a balanced entry once per source key", async () => {
    const first = await post(orgA, sale, saleLines);
    const second = await post(orgA, sale, saleLines);
    expect(second).toBe(first);
    const count = await db.query<{ n: number }>("select count(*)::int as n from public.journal_lines where entry_id = $1", [first]);
    expect(count.rows[0]!.n).toBe(3);
  });

  it("rejects unbalanced entries and leaves nothing behind", async () => {
    await expect(
      post(orgA, { memo: "bad", entry_date: "2026-10-05" }, [
        { account_key: "bank", debit_paise: 100 },
        { account_key: "cash", credit_paise: 90 },
      ])
    ).rejects.toThrow(/unbalanced/);
    const count = await db.query<{ n: number }>("select count(*)::int as n from public.journal_entries where memo = 'bad'");
    expect(count.rows[0]!.n).toBe(0);
  });

  it("rejects unknown accounts and single-line entries", async () => {
    await expect(post(orgA, { memo: "x" }, [{ account_key: "nope", debit_paise: 1 }, { account_key: "bank", credit_paise: 1 }])).rejects.toThrow(
      /unknown ledger account/
    );
    await expect(post(orgA, { memo: "x" }, [{ account_key: "bank", debit_paise: 1 }])).rejects.toThrow(/two lines/);
  });

  it("does not resolve another organization's accounts", async () => {
    const id = await post(orgB, { memo: "B capital", entry_date: "2026-10-01" }, [
      { account_key: "bank", debit_paise: 500 },
      { account_key: "owner_equity", credit_paise: 500 },
    ]);
    const owners = await db.query<{ n: number }>(
      "select count(*)::int as n from public.journal_lines l join public.ledger_accounts a on a.id = l.account_id where l.entry_id = $1 and a.organization_id <> $2",
      [id, orgB]
    );
    expect(owners.rows[0]!.n).toBe(0);
  });

  it("blocks edits to posted lines", async () => {
    await expect(db.query("update public.journal_lines set debit_paise = debit_paise + 1 where organization_id = $1", [orgA])).rejects.toThrow(
      /reversal/
    );
  });

  it("blocks edits to posted entries", async () => {
    await expect(db.query("update public.journal_entries set entry_date = '2020-01-01' where organization_id = $1", [orgA])).rejects.toThrow(
      /reversal/
    );
  });

  it("will not let an unbalanced DRAFT be flipped to POSTED", async () => {
    const draft = await db.query<{ id: string }>(
      "insert into public.journal_entries (organization_id, memo, status) values ($1, 'draft', 'DRAFT') returning id",
      [orgA]
    );
    const id = draft.rows[0]!.id;
    await db.query(
      "insert into public.journal_lines (organization_id, entry_id, account_id, debit_paise) select $1, $2, id, 500 from public.ledger_accounts where organization_id = $1 and system_key = 'bank'",
      [orgA, id]
    );
    await expect(db.query("update public.journal_entries set status = 'POSTED' where id = $1", [id])).rejects.toThrow(/unbalanced/);
  });

  it("totals accounts by period", async () => {
    const totals = await db.query<{ system_key: string; credit_paise: string }>(
      "select system_key, credit_paise from public.accounting_account_totals($1::uuid, '2026-10-01', '2026-10-31') where system_key = 'sales'",
      [orgA]
    );
    expect(Number(totals.rows[0]!.credit_paise)).toBe(10000);
    const outside = await db.query<{ credit_paise: string }>(
      "select credit_paise from public.accounting_account_totals($1::uuid, '2026-11-01', '2026-11-30') where system_key = 'sales'",
      [orgA]
    );
    expect(Number(outside.rows[0]!.credit_paise)).toBe(0);
  });
});

describe("consume_addon_question", () => {
  it("stops at the limit", async () => {
    const args = [orgA, "ai-accountant", "assistant_questions", "2026-10-01T00:00:00Z", 2];
    const sql = "select * from public.consume_addon_question($1::uuid, $2, $3, $4::timestamptz, $5::int)";
    const a = await db.query<{ usage_id: string | null; remaining: number }>(sql, args);
    const b = await db.query<{ usage_id: string | null; remaining: number }>(sql, args);
    const c = await db.query<{ usage_id: string | null; remaining: number }>(sql, args);
    expect(a.rows[0]!.usage_id).toBeTruthy();
    expect(b.rows[0]!.remaining).toBe(0);
    expect(c.rows[0]!.usage_id).toBeNull();
  });
});

describe("tenant RLS", () => {
  it("members cannot grant themselves the add-on or reset usage", async () => {
    await asUser(OWNER, async () => {
      await expect(
        db.query(
          "insert into public.organization_entitlements (organization_id, addon_slug, status, access_mode) values ($1, 'ai-accountant', 'ACTIVE', 'FULL')",
          [orgA]
        )
      ).rejects.toThrow(/permission denied/);
      await expect(db.query("delete from public.addon_usage_events where organization_id = $1", [orgA])).rejects.toThrow(
        /permission denied/
      );
    });
  });

  it("viewers read books but cannot write them", async () => {
    await asUser(VIEWER, async () => {
      const rows = await db.query<{ n: number }>("select count(*)::int as n from public.journal_entries where organization_id = $1", [orgA]);
      expect(rows.rows[0]!.n).toBeGreaterThan(0);
      await expect(
        db.query("insert into public.expenses (organization_id, category, amount, incurred_on) values ($1, 'rent', 10, '2026-10-01')", [orgA])
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("owners write expenses; outsiders see nothing", async () => {
    await asUser(OWNER, async () => {
      await db.query("insert into public.expenses (organization_id, category, amount, incurred_on) values ($1, 'rent', 10, '2026-10-01')", [
        orgA,
      ]);
    });
    await asUser(OUTSIDER, async () => {
      const rows = await db.query<{ n: number }>("select count(*)::int as n from public.expenses where organization_id = $1", [orgA]);
      expect(rows.rows[0]!.n).toBe(0);
      const journal = await db.query<{ n: number }>("select count(*)::int as n from public.journal_lines where organization_id = $1", [orgA]);
      expect(journal.rows[0]!.n).toBe(0);
    });
  });

  it("owners cannot write the journal directly", async () => {
    await asUser(OWNER, async () => {
      await expect(
        db.query("insert into public.journal_entries (organization_id, memo, status) values ($1, 'direct', 'DRAFT')", [orgA])
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("signed-in users cannot call the posting RPC", async () => {
    await asUser(OWNER, async () => {
      await expect(post(orgA, { memo: "x" }, saleLines)).rejects.toThrow(/permission denied/);
    });
  });
});
