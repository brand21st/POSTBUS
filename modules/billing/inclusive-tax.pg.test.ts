import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { commissionPaise } from "@/modules/affiliates/policy";

let db: PGlite;
const admin = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000003";
const partner = "20000000-0000-4000-8000-000000000001";
const org = "30000000-0000-4000-8000-000000000001";
const otherOrg = "30000000-0000-4000-8000-000000000002";
const link = "40000000-0000-4000-8000-000000000001";
const pay = "50000000-0000-4000-8000-000000000001";
const sub = "60000000-0000-4000-8000-000000000001";

async function scalar(sql: string, args: unknown[] = []) {
    const result = await db.query<Record<string, unknown>>(sql, args);
    return Object.values(result.rows[0] || {})[0];
}

async function rejected(sql: string, args: unknown[] = []) {
    await db.exec("savepoint rejection");
    try {
        await expect(db.query(sql, args)).rejects.toThrow();
    }
    finally {
        await db.exec("rollback to savepoint rejection");
    }
}

describe("subscription tax policy persistence", () => {
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
    }, 30000);
    afterAll(async () => { await db?.close(); });
    beforeEach(async () => {
        await db.exec("begin");
        await db.query("insert into auth.users(id) values($1),($2)", [admin, other]);
        await db.query("insert into platform_admins values($1)", [admin]);
        await db.query("insert into organizations(id,name) values($1,'Merchant'),($2,'Other')", [org, otherOrg]);
        await db.query("insert into subscriptions(id,organization_id) values($1,$2)", [sub, org]);
        await db.query("insert into payments(id,organization_id,subscription_id,billing_cycle,amount_paise,razorpay_payment_id,created_at) values($1,$2,$3,'monthly',149900,'pay_inclusive',now())", [pay, org, sub]);
    });
    afterEach(async () => { await db.exec("rollback"); });

    it("refuses a draft and a non-admin, then records one reconciled breakdown", async () => {
        await rejected("select subscription_propose_tax_policy($1,$2::jsonb)", [other, JSON.stringify({ treatment: "SINGLE_RATE_INCLUSIVE", rateBasisPoints: 1800, placeOfSupply: "INTRA", effectiveAt: "2026-01-01T00:00:00Z", reason: "Unauthorized" })]);
        const draft = await scalar("select subscription_propose_tax_policy($1,$2::jsonb)", [admin, JSON.stringify({ treatment: "SINGLE_RATE_INCLUSIVE", rateBasisPoints: 1800, placeOfSupply: "INTRA", effectiveAt: "2020-01-01T00:00:00Z", reason: "Test fixture rate" })]);
        expect(await scalar("select subscription_apply_approved_tax($1)", [pay])).toBe("MISSING_CONFIGURATION");
        expect(await scalar("select subscription_approve_tax_policy($1,$2)", [admin, draft])).toBe("APPROVED");
        expect(await scalar("select subscription_apply_approved_tax($1)", [pay])).toBe("RECORDED");
        expect(Number(await scalar("select taxable_paise from subscription_tax_breakdowns where payment_id=$1", [pay]))).toBe(127034);
        expect(Number(await scalar("select total_tax_paise from subscription_tax_breakdowns where payment_id=$1", [pay]))).toBe(22866);
        expect(Number(await scalar("select cgst_paise + sgst_paise + igst_paise from subscription_tax_breakdowns where payment_id=$1", [pay]))).toBe(22866);
        expect(Number(await scalar("select amount_paise from payments where id=$1", [pay]))).toBe(149900);
        expect(await scalar("select subscription_apply_approved_tax($1)", [pay])).toBe("ALREADY_RECORDED");
        expect(Number(await scalar("select count(*) from affiliate_tax_evidence where payment_id=$1", [pay]))).toBe(1);
        expect(Number(await scalar("select count(*) from subscription_tax_breakdowns where payment_id=$1", [pay]))).toBe(1);
    });

    it("accrues 20 percent of the verified net once", async () => {
        const draft = await scalar("select subscription_propose_tax_policy($1,$2::jsonb)", [admin, JSON.stringify({ treatment: "SINGLE_RATE_INCLUSIVE", rateBasisPoints: 1800, placeOfSupply: "INTRA", effectiveAt: "2020-01-01T00:00:00Z", reason: "Test fixture rate" })]);
        await db.query("select subscription_approve_tax_policy($1,$2)", [admin, draft]);
        await db.query("insert into affiliate_profiles(id,user_id,status,application,terms_version) values($1,$2,'APPROVED','{}','v1')", [partner, admin]);
        await db.query("insert into affiliate_links(id,affiliate_id,code) values($1,$2,'abcdefghijklmnopqrstuvwx')", [link, partner]);
        await db.query("insert into affiliate_attributions(organization_id,affiliate_id,link_id,created_at) values($1,$2,$3,now()-interval '60 days')", [org, partner, link]);
        await db.query("insert into affiliate_policies(basis_points,effective_at) values(2000,now()-interval '90 days')");
        await db.query("insert into affiliate_payment_evidence(payment_id,provider_payment_id,amount_paise,refunded_paise,captured_at,source) values($1,'pay_inclusive',149900,0,now()-interval '40 days','test')", [pay]);
        expect(await scalar("select subscription_apply_approved_tax($1)", [pay])).toBe("RECORDED");
        expect(await scalar("select affiliate_accrue($1)", [pay])).toBe("RECONCILED");
        expect(Number(await scalar("select amount_paise from affiliate_commissions where payment_id=$1", [pay]))).toBe(Number(commissionPaise(BigInt(127034), BigInt(2000))));
        expect(await scalar("select affiliate_accrue($1)", [pay])).toBe("RECONCILED");
        expect(Number(await scalar("select count(*) from affiliate_commissions where payment_id=$1", [pay]))).toBe(1);
    });

    it("keeps the original breakdown when a later policy is approved", async () => {
        const first = await scalar("select subscription_propose_tax_policy($1,$2::jsonb)", [admin, JSON.stringify({ treatment: "SINGLE_RATE_INCLUSIVE", rateBasisPoints: 1800, placeOfSupply: "INTRA", effectiveAt: "2020-01-01T00:00:00Z", reason: "First fixture" })]);
        await db.query("select subscription_approve_tax_policy($1,$2)", [admin, first]);
        await db.query("select subscription_apply_approved_tax($1)", [pay]);
        const second = await scalar("select subscription_propose_tax_policy($1,$2::jsonb)", [admin, JSON.stringify({ treatment: "SINGLE_RATE_INCLUSIVE", rateBasisPoints: 500, placeOfSupply: "INTER", effectiveAt: "2099-01-01T00:00:00Z", reason: "Later fixture" })]);
        await db.query("select subscription_approve_tax_policy($1,$2)", [admin, second]);
        expect(Number(await scalar("select total_tax_paise from subscription_tax_breakdowns where payment_id=$1", [pay]))).toBe(22866);
        await rejected("update subscription_tax_policies set rate_basis_points=500 where id=$1", [first]);
    });

    it("rejects conflicting manual evidence, cross-organization payments, and ineligible charges", async () => {
        const draft = await scalar("select subscription_propose_tax_policy($1,$2::jsonb)", [admin, JSON.stringify({ treatment: "SINGLE_RATE_INCLUSIVE", rateBasisPoints: 1800, placeOfSupply: "INTRA", effectiveAt: "2020-01-01T00:00:00Z", reason: "Conflict fixture" })]);
        await db.query("select subscription_approve_tax_policy($1,$2)", [admin, draft]);
        await db.query("insert into affiliate_tax_evidence(payment_id,refunded_paise,tax_paise,refunded_tax_paise,reason,actor_id) values($1,0,1,0,'Manual row',$2)", [pay, admin]);
        expect(await scalar("select subscription_apply_approved_tax($1)", [pay])).toBe("CONFLICT");
        expect(Number(await scalar("select count(*) from subscription_tax_breakdowns"))).toBe(0);
        const mismatch = "50000000-0000-4000-8000-000000000007";
        await db.query("insert into payments(id,organization_id,subscription_id,billing_cycle,amount_paise,currency) values($1,$2,$3,'monthly',149900,'INR')", [mismatch, otherOrg, sub]);
        expect(await scalar("select subscription_apply_approved_tax($1)", [mismatch])).toBe("INELIGIBLE");
        const credit = "50000000-0000-4000-8000-000000000008";
        await db.query("insert into payments(id,organization_id,subscription_id,billing_cycle,amount_paise,currency) values($1,$2,$3,'ai_credits',9900,'INR')", [credit, org, sub]);
        expect(await scalar("select subscription_apply_approved_tax($1)", [credit])).toBe("INELIGIBLE");
    });

    it("denies authenticated reads and writes", async () => {
        await db.exec("set local role authenticated");
        await rejected("select * from subscription_tax_policies");
        await rejected("select subscription_apply_approved_tax($1)", [pay]);
    });
});
