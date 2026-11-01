import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";

let db: PGlite;
const admin = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000003";
const org = "30000000-0000-4000-8000-000000000001";
const otherOrg = "30000000-0000-4000-8000-000000000002";
const pay = "50000000-0000-4000-8000-000000000001";
const sub = "60000000-0000-4000-8000-000000000001";
const supplier = { supplierLegalName: "Example Supplier", supplierAddress: "Example address", supplierGstin: "29ABCDE1234F1Z5", customerLegalName: "Example Merchant", customerAddress: "Merchant address", customerGstin: "", planName: "Pro", billingCycle: "monthly", series: "2026-27", prefix: "PB", serviceDescription: "PostBus subscription", paymentReference: "pay_inclusive" };

async function scalar(sql: string, args: unknown[] = []) {
    const result = await db.query<Record<string, unknown>>(sql, args);
    return Object.values(result.rows[0] || {})[0];
}
async function rejected(sql: string, args: unknown[] = []) {
    await db.exec("savepoint rejection");
    try { await expect(db.query(sql, args)).rejects.toThrow(); }
    finally { await db.exec("rollback to savepoint rejection"); }
}

describe("subscription tax invoice persistence", () => {
    beforeAll(async () => {
        db = new PGlite();
        await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public, auth to anon, authenticated, service_role;
 create table organizations(id uuid primary key, name text);
 create table organization_members(organization_id uuid, user_id uuid);
 create table subscriptions(id uuid primary key, organization_id uuid);
 create table payments(id uuid primary key, organization_id uuid, subscription_id uuid, billing_cycle text, currency text default 'INR', amount_paise bigint, razorpay_payment_id text, paid_at timestamptz, created_at timestamptz default now());
 create table platform_admins(user_id uuid);
 create function create_organization_for_user(p_name text) returns organizations language plpgsql as $$declare o organizations; begin insert into organizations(id,name) values(gen_random_uuid(),p_name) returning * into o; return o; end$$;
 `);
        await db.exec(readFileSync("supabase/migrations/20261017120000_affiliate_program.sql", "utf8"));
        await db.exec(readFileSync("supabase/migrations/20261017130000_subscription_tax_policy.sql", "utf8"));
        await db.exec(readFileSync("supabase/migrations/20261017140000_subscription_tax_invoices.sql", "utf8"));
    }, 30000);
    afterAll(async () => { await db?.close(); });
    beforeEach(async () => {
        await db.exec("begin");
        await db.query("insert into auth.users(id) values($1),($2)", [admin, other]);
        await db.query("insert into platform_admins values($1)", [admin]);
        await db.query("insert into organizations(id,name) values($1,'Merchant'),($2,'Other')", [org, otherOrg]);
        await db.query("insert into subscriptions(id,organization_id) values($1,$2)", [sub, org]);
        await db.query("insert into payments(id,organization_id,subscription_id,billing_cycle,amount_paise,razorpay_payment_id) values($1,$2,$3,'monthly',149900,'pay_inclusive')", [pay, org, sub]);
        const policy = await scalar("select subscription_propose_tax_policy($1,$2::jsonb)", [admin, JSON.stringify({ treatment: "SINGLE_RATE_INCLUSIVE", rateBasisPoints: 1800, placeOfSupply: "INTRA", effectiveAt: "2020-01-01T00:00:00Z", reason: "Invoice fixture" })]);
        await db.query("select subscription_approve_tax_policy($1,$2)", [admin, policy]);
        await db.query("select subscription_apply_approved_tax($1)", [pay]);
    });
    afterEach(async () => { await db.exec("rollback"); });

    async function payload(overrides: Record<string, unknown> = {}) {
        const breakdown = await db.query<Record<string, unknown>>("select * from subscription_tax_breakdowns where payment_id=$1", [pay]);
        const row = breakdown.rows[0];
        return { paymentId: pay, organizationId: org, subscriptionId: sub, policyId: row.policy_id, policyVersion: Number(row.policy_version), grossPaise: Number(row.gross_paise), taxablePaise: Number(row.taxable_paise), cgstPaise: Number(row.cgst_paise), sgstPaise: Number(row.sgst_paise), igstPaise: Number(row.igst_paise), totalTaxPaise: Number(row.total_tax_paise), ...supplier, ...overrides };
    }

    it("issues one number, repeats it, and refuses a second document", async () => {
        const body = await payload();
        const first = await scalar("select subscription_issue_tax_invoice($1,$2::jsonb)", [admin, JSON.stringify(body)]);
        const second = await scalar("select subscription_issue_tax_invoice($1,$2::jsonb)", [admin, JSON.stringify(body)]);
        expect(first).toBe("PB/2026-27/000001");
        expect(second).toBe(first);
        expect(Number(await scalar("select count(*) from subscription_tax_invoices"))).toBe(1);
        expect(Number(await scalar("select amount_paise from payments where id=$1", [pay]))).toBe(149900);
        await rejected("update subscription_tax_invoices set gross_paise=1");
        expect(await scalar("select subscription_invoice_reconcile($1)", [pay])).toBe("MATCHED");
    });

    it("refuses issuance without a supplier GSTIN and reports a missing invoice", async () => {
        await rejected("select subscription_issue_tax_invoice($1,$2::jsonb)", [admin, JSON.stringify(await payload({ supplierGstin: "" }))]);
        expect(await scalar("select subscription_invoice_reconcile($1)", [pay])).toBe("MISSING_INVOICE");
        await rejected("select subscription_issue_tax_invoice($1,$2::jsonb)", [other, JSON.stringify(await payload())]);
    });

    it("rejects a cross-organization payment and an authenticated read of another org", async () => {
        await rejected("select subscription_issue_tax_invoice($1,$2::jsonb)", [admin, JSON.stringify(await payload({ organizationId: otherOrg }))]);
        await db.query("select subscription_issue_tax_invoice($1,$2::jsonb)", [admin, JSON.stringify(await payload())]);
        await db.query("insert into organization_members(organization_id,user_id) values($1,$2)", [otherOrg, other]);
        await db.exec(`select set_config('request.jwt.claim.sub', '${other}', true)`);
        await db.exec("set local role authenticated");
        expect(Number(await scalar("select count(*) from subscription_tax_invoices"))).toBe(0);
    });
});
