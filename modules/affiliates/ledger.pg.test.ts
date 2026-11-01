import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from "vitest";
let db: PGlite;
const u = "10000000-0000-4000-8000-000000000001", merchant = "10000000-0000-4000-8000-000000000002", other = "10000000-0000-4000-8000-000000000003";
const a = "20000000-0000-4000-8000-000000000001", org = "30000000-0000-4000-8000-000000000001", link = "40000000-0000-4000-8000-000000000001", pay = "50000000-0000-4000-8000-000000000001", sub = "60000000-0000-4000-8000-000000000001", account = "70000000-0000-4000-8000-000000000001";
const key = "80000000-0000-4000-8000-000000000001";
async function scalar(sql: string, args: unknown[] = []) { const r = await db.query<Record<string, unknown>>(sql, args); return Object.values(r.rows[0] || {})[0]; }
async function rejected(sql: string, args: unknown[] = []) { await db.exec("savepoint rejection"); try {
    await expect(db.query(sql, args)).rejects.toThrow();
}
finally {
    await db.exec("rollback to savepoint rejection");
} }
async function evidence(refund = 0, refundTax = 0) { await db.query("insert into affiliate_payment_evidence(payment_id,provider_payment_id,amount_paise,refunded_paise,captured_at,source) values($1,'pay_test',1000000,$2,now()-interval '40 days','test')", [pay, refund]); await db.query("insert into affiliate_tax_evidence(payment_id,refunded_paise,tax_paise,refunded_tax_paise,reason,actor_id) values($1,$2,0,$3,'Verified test invoice',$4)", [pay, refund, refundTax, u]); }
async function accrue() { return scalar("select affiliate_accrue($1)", [pay]); }
async function balance() { return scalar("select affiliate_balance($1)", [a]) as Promise<{
    available: string;
    paid: string;
    recoverable: string;
}>; }
async function payout(amount = 100000, k = key) { return scalar("select affiliate_request_payout($1,$2,$3,$4)", [a, account, amount, k]); }
describe("affiliate PostgreSQL transactions and RLS", () => {
    beforeAll(async () => {
        db = new PGlite();
        await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,created_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated,service_role;
 create table organizations(id uuid primary key default gen_random_uuid(),name text);
 create table organization_members(organization_id uuid references organizations(id),user_id uuid references auth.users(id));
 create table subscriptions(id uuid primary key,organization_id uuid,status text default 'ACTIVE',created_at timestamptz default now());
 create table payments(id uuid primary key,organization_id uuid,subscription_id uuid,billing_cycle text,currency text default 'INR',amount_paise bigint,razorpay_payment_id text,paid_at timestamptz,created_at timestamptz default now());
 create table platform_admins(user_id uuid);
 create table razorpay_webhook_events(id uuid primary key default gen_random_uuid(),event_id text unique,event text,payload jsonb,status text,created_at timestamptz default now());
 create function create_organization_for_user(p_name text) returns organizations language plpgsql as $$declare o organizations;begin insert into organizations(name) values(p_name) returning * into o;insert into organization_members values(o.id,auth.uid());return o;end$$;
 `);
        for (const file of ["20261017120000_affiliate_program.sql", "20261017121000_affiliate_operations.sql", "20261017122000_affiliate_webhook_leases.sql", "20261017123000_affiliate_reporting.sql", "20261017124000_affiliate_reconciliation.sql", "20261017125000_affiliate_partner_portal.sql", "20261017130000_subscription_tax_policy.sql", "20261017140000_subscription_tax_invoices.sql"]) {
            await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
        }
    }, 30000);
    afterAll(async () => { await db?.close(); });
    beforeEach(async () => {
        await db.exec("begin");
        await db.query("insert into auth.users(id) values($1),($2),($3)", [u, merchant, other]);
        await db.query("insert into platform_admins values($1)", [u]);
        await db.query("insert into affiliate_profiles(id,user_id,status,application,terms_version) values($1,$2,'APPROVED','{}','v1')", [a, u]);
        await db.query("insert into organizations(id,name) values($1,'Merchant')", [org]);
        await db.query("insert into subscriptions(id,organization_id) values($1,$2)", [sub, org]);
        await db.query("insert into affiliate_links(id,affiliate_id,code) values($1,$2,'abcdefghijklmnopqrstuvwx')", [link, a]);
        await db.query("insert into affiliate_attributions(organization_id,affiliate_id,link_id,created_at) values($1,$2,$3,now()-interval '60 days')", [org, a, link]);
        await db.query("insert into payments(id,organization_id,subscription_id,billing_cycle,amount_paise,razorpay_payment_id) values($1,$2,$3,'MONTHLY',1000000,'pay_test')", [pay, org, sub]);
        await db.query("insert into affiliate_payout_accounts(id,affiliate_id,encrypted_details,masked_details) values($1,$2,'encrypted','masked')", [account, a]);
        // Program policy predates this test's captured payment.
        await db.query("insert into affiliate_policies(basis_points,effective_at) values(2000,now()-interval '90 days')");
    });
    afterEach(async () => { await db.exec("rollback"); });
    it("webhook leases reject concurrent claims and retry failed or abandoned work",async()=>{
      await db.query("insert into razorpay_webhook_events(event_id,event,payload,status) values('evt-1','payment.captured','{}','received')");
      expect(await scalar("select claim_razorpay_webhook('evt-1')")).toMatchObject({state:"claimed"});
      expect(await scalar("select claim_razorpay_webhook('evt-1')")).toMatchObject({state:"busy"});
      await db.exec("update razorpay_webhook_events set status='failed',processing_until=null");
      expect(await scalar("select claim_razorpay_webhook('evt-1')")).toMatchObject({state:"claimed"});
      await db.exec("update razorpay_webhook_events set processing_until=now()-interval '1 minute'");
      expect(await scalar("select claim_razorpay_webhook('evt-1')")).toMatchObject({state:"claimed"});
      await db.exec("update razorpay_webhook_events set status='processed'");
      expect(await scalar("select claim_razorpay_webhook('evt-1')")).toMatchObject({state:"complete"});
    });
    it("does not accrue an unpaid trial and accrues a later renewal once", async () => {
        await db.query("update subscriptions set status='TRIAL' where id=$1", [sub]);
        expect(await accrue()).toBe("CAPTURE_REVIEW");
        expect(await scalar("select count(*) from affiliate_commissions")).toBe(0);
        await evidence();
        await accrue();
        const renewal = "50000000-0000-4000-8000-000000000009";
        await db.query("insert into payments(id,organization_id,subscription_id,billing_cycle,amount_paise,razorpay_payment_id) values($1,$2,$3,'MONTHLY',1000000,'pay_renewal')", [renewal, org, sub]);
        await db.query("insert into affiliate_payment_evidence(payment_id,provider_payment_id,amount_paise,refunded_paise,captured_at,source) values($1,'pay_renewal',1000000,0,now()-interval '40 days','test')", [renewal]);
        await db.query("insert into affiliate_tax_evidence(payment_id,refunded_paise,tax_paise,refunded_tax_paise,reason,actor_id) values($1,0,0,0,'Verified renewal',$2)", [renewal, u]);
        expect(await scalar("select affiliate_accrue($1)", [renewal])).toBe("RECONCILED");
        expect(await scalar("select affiliate_accrue($1)", [renewal])).toBe("RECONCILED");
        expect(await scalar("select count(*) from affiliate_commissions")).toBe(2);
        const filtered = await scalar("select affiliate_partner_records($1,'referrals',0,'does-not-match','',now()-interval '1 day',now())", [a]);
        expect(filtered).toEqual([]);
    });
    it("stores the approved default policy in one settings row", async () => {
        expect(await scalar("select attribution_days from affiliate_settings")).toBe(30);
        expect(await scalar("select hold_days from affiliate_settings")).toBe(30);
        expect(Number(await scalar("select minimum_payout_paise from affiliate_settings"))).toBe(100000);
        expect(await scalar("select basis_points from affiliate_policies where affiliate_id is null order by version desc limit 1")).toBe(2000);
    });
    it("classifies missing tax without creating a commission, then matches after evidence", async () => {
        const before = await scalar("select count(*) from affiliate_commissions");
        const unverified = JSON.stringify(await scalar("select affiliate_reconciliation_report(20)"));
        expect(unverified).toContain("PAYMENT_UNVERIFIED");
        expect(await scalar("select count(*) from affiliate_commissions")).toBe(before);
        await db.query("insert into affiliate_payment_evidence(payment_id,provider_payment_id,amount_paise,refunded_paise,captured_at,source) values($1,'pay_test',1000000,0,now()-interval '40 days','test')", [pay]);
        expect(JSON.stringify(await scalar("select affiliate_reconciliation_report(20)"))).toContain("MISSING_TAX_EVIDENCE");
        expect(await scalar("select count(*) from affiliate_commissions")).toBe(before);
        await db.query("insert into affiliate_tax_evidence(payment_id,refunded_paise,tax_paise,refunded_tax_paise,reason,actor_id) values($1,0,0,0,'Verified',$2)", [pay, u]);
        expect(JSON.stringify(await scalar("select affiliate_reconciliation_report(20)"))).toContain("MISSING_COMMISSION");
        await accrue();
        expect(JSON.stringify(await scalar("select affiliate_reconciliation_report(20)"))).toContain("MATCHED");
        const yearly = "50000000-0000-4000-8000-000000000008";
        await db.query("insert into payments(id,organization_id,subscription_id,billing_cycle,amount_paise,razorpay_payment_id) values($1,$2,$3,'YEARLY',2000000,'pay_year')", [yearly, org, sub]);
        await db.query("insert into affiliate_payment_evidence(payment_id,provider_payment_id,amount_paise,refunded_paise,captured_at,source) values($1,'pay_year',2000000,0,now()-interval '40 days','test')", [yearly]);
        await db.query("insert into affiliate_tax_evidence(payment_id,refunded_paise,tax_paise,refunded_tax_paise,reason,actor_id) values($1,0,0,0,'Yearly',$2)", [yearly, u]);
        expect(await scalar("select affiliate_accrue($1)", [yearly])).toBe("RECONCILED");
        expect(await scalar("select amount_paise from affiliate_commissions where payment_id=$1", [yearly])).toBe(400000);
        const shipping = "50000000-0000-4000-8000-000000000007";
        await db.query("insert into payments(id,organization_id,billing_cycle,amount_paise,razorpay_payment_id) values($1,$2,'shipment',50000,'pay_ship')", [shipping, org]);
        expect(await scalar("select affiliate_accrue($1)", [shipping])).toBe("INELIGIBLE");
        expect(JSON.stringify(await scalar("select affiliate_reconciliation_report(20)"))).toContain("OWNERSHIP_MISMATCH");
        const credits = "50000000-0000-4000-8000-000000000006";
        await db.query("insert into payments(id,organization_id,subscription_id,billing_cycle,amount_paise,razorpay_payment_id) values($1,$2,$3,'ai_credits',9900,'pay_ai')", [credits, org, sub]);
        expect(await scalar("select affiliate_accrue($1)", [credits])).toBe("INELIGIBLE");
    });
    it("report projections hide organization and provider identifiers",async()=>{
      await evidence();await accrue();const rows=await scalar("select affiliate_partner_records($1,'referrals',0)",[a]);
      expect(JSON.stringify(rows)).not.toContain(org);expect(JSON.stringify(rows)).toContain("Merchant ");
      expect(await scalar("select affiliate_admin_overview()")).toMatchObject({partners:1,paidMerchants:1});
    });
    it("returned external payouts restore funds once with immutable entries",async()=>{
      await evidence();await accrue();const id=await payout();
      await db.query("select affiliate_settle_payout($1,'APPROVED','',$2,'Approved')",[id,u]);
      await db.query("select affiliate_settle_payout($1,'PAID','ref-return',$2,'Confirmed')",[id,u]);
      await db.query("select affiliate_settle_payout($1,'RETURNED','',$2,'Bank returned funds')",[id,u]);
      await db.query("select affiliate_settle_payout($1,'RETURNED','',$2,'Bank returned funds')",[id,u]);
      expect((await balance()).available).toBe("200000");expect((await balance()).paid).toBe("0");
    });
    it("different-tenant subscription and AI credit payments are ineligible",async()=>{
      await evidence();await db.query("update payments set billing_cycle='ai_credits' where id=$1",[pay]);expect(await accrue()).toBe("INELIGIBLE");
      await db.query("update payments set billing_cycle='monthly' where id=$1",[pay]);await db.query("update subscriptions set organization_id=$1",[other]);expect(await accrue()).toBe("INELIGIBLE");
    });
    it("requires verified capture and tax evidence", async () => { expect(await accrue()).toBe("CAPTURE_REVIEW"); await db.query("insert into affiliate_payment_evidence(payment_id,provider_payment_id,amount_paise,refunded_paise,captured_at,source) values($1,'pay_test',1000000,0,now()-interval '40 days','test')", [pay]); expect(await accrue()).toBe("TAX_REVIEW"); expect(await scalar("select count(*) from affiliate_commissions")).toBe(0); });
    it("accrues and approves exactly once under repeated delivery", async () => { await evidence(); await accrue(); await accrue(); expect(await scalar("select count(*) from affiliate_commissions")).toBe(1); expect((await balance()).available).toBe("200000"); });
    it("holds recent captured earnings", async () => { await db.query("insert into affiliate_payment_evidence(payment_id,provider_payment_id,amount_paise,refunded_paise,captured_at,source) values($1,'pay_test',1000000,0,now(),'test')", [pay]); await db.query("insert into affiliate_tax_evidence(payment_id,refunded_paise,tax_paise,refunded_tax_paise,reason,actor_id) values($1,0,0,0,'Invoice',$2)", [pay, u]); expect(await accrue()).toBe("HOLD"); expect((await balance()).available).toBe("0"); });
    it("reserves once, rejects overspending and duplicate-key mismatches", async () => { await evidence(); await accrue(); const id = await payout(150000); expect(await payout(150000)).toBe(id); await rejected("select affiliate_request_payout($1,$2,100000,$3)", [a, account, "80000000-0000-4000-8000-000000000002"]); await rejected("select affiliate_request_payout($1,$2,100000,$3)", [a, account, key]); expect((await balance()).available).toBe("50000"); });
    it("requires approval then settles once; duplicate settlement cannot pay twice", async () => { await evidence(); await accrue(); const id = await payout(); await rejected("select affiliate_settle_payout($1,'PAID','ref-1',$2,'Confirmed')", [id, u]); await db.query("select affiliate_settle_payout($1,'APPROVED','',$2,'Approved')", [id, u]); await db.query("select affiliate_settle_payout($1,'PAID','ref-1',$2,'Confirmed')", [id, u]); await db.query("select affiliate_settle_payout($1,'PAID','ref-1',$2,'Confirmed')", [id, u]); expect((await balance()).paid).toBe("100000"); expect(await scalar("select count(*) from affiliate_payout_allocations")).toBe(1); });
    it("releases rejected reservations", async () => { await evidence(); await accrue(); const id = await payout(); await db.query("select affiliate_settle_payout($1,'REJECTED','',$2,'Rejected')", [id, u]); expect((await balance()).available).toBe("200000"); });
    it("partial and full refunds are cumulative and create post-payout recovery", async () => { await evidence(); await accrue(); const id = await payout(200000); await db.query("select affiliate_settle_payout($1,'APPROVED','',$2,'Approved')", [id, u]); await db.query("select affiliate_settle_payout($1,'PAID','ref-2',$2,'Confirmed')", [id, u]); await evidence(250000); await accrue(); expect((await balance()).recoverable).toBe("50000"); await evidence(1000000); await accrue(); await accrue(); expect((await balance()).recoverable).toBe("200000"); expect((await balance()).available).toBe("0"); });
    it("suspension preserves accrual but blocks payout", async () => { await db.query("update affiliate_profiles set status='SUSPENDED' where id=$1", [a]); await evidence(); expect(await accrue()).toBe("RECONCILED"); await rejected("select affiliate_request_payout($1,$2,100000,$3)", [a, account, key]); });
    it("policy changes do not rewrite historical commissions", async () => { await evidence(); await accrue(); await db.query("insert into affiliate_policies(basis_points) values(5000)"); await accrue(); expect(await scalar("select amount_paise from affiliate_commissions")).toBe(200000); });
    it("immutable rows reject updates even by the database owner", async () => { await evidence(); await accrue(); await rejected("update affiliate_commissions set amount_paise=1"); await rejected("delete from affiliate_ledger_entries"); });
    it("partner RLS exposes only own rows and denies financial writes", async () => { await evidence(); await accrue(); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [other]); await db.exec("set local role authenticated"); expect(await scalar("select count(*) from affiliate_commissions")).toBe(0); await rejected("select affiliate_request_payout($1,$2,100000,$3)", [a, account, key]); await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [u]); await db.exec("set local role authenticated"); expect(await scalar("select count(*) from affiliate_commissions")).toBe(1); await rejected("update affiliate_profiles set status='APPROVED'"); await rejected("select encrypted_details from affiliate_payout_accounts"); });
    it("signup claim is first-touch, blocks self-referrals, and binds atomically", async () => { await db.query("select affiliate_bind_signup($1,$2,now()+interval '30 days')", [u, link]); expect(await scalar("select count(*) from affiliate_signup_claims")).toBe(0); await db.query("select affiliate_bind_signup($1,$2,now()+interval '30 days')", [merchant, link]); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [merchant]); await db.query("select affiliate_create_organization('New merchant')"); expect(await scalar("select count(*) from affiliate_attributions")).toBe(2); await db.query("select affiliate_create_organization('Again')"); expect(await scalar("select count(*) from affiliate_attributions")).toBe(2); });
    it("expired claim never attributes a new organization", async () => { await db.query("insert into affiliate_signup_claims values($1,$2,now()-interval '1 day',now())", [merchant, link]); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [merchant]); await db.query("select affiliate_create_organization('Expired')"); expect(await scalar("select count(*) from affiliate_attributions")).toBe(1); });
    it("admin actions require a platform admin and write audit atomically", async () => { await rejected("select affiliate_admin_action($1,'status',$2,'{\"status\":\"SUSPENDED\",\"reason\":\"Fraud review\"}')", [other, a]); await db.query("select affiliate_admin_action($1,'status',$2,'{\"status\":\"SUSPENDED\",\"reason\":\"Fraud review\"}')", [u, a]); expect(await scalar("select count(*) from affiliate_audit_logs where action='status'")).toBe(1); });
    it("deduplicates repeated clicks without storing IP addresses", async () => { await db.query("select affiliate_record_click($1,$2)", [link, "a".repeat(32)]); await db.query("select affiliate_record_click($1,$2)", [link, "a".repeat(32)]); expect(await scalar("select count(*) from affiliate_click_events")).toBe(1); });
    it("partner portal reporting hides merchant identity and maps ledger statuses", async () => {
        await db.query("select affiliate_record_click($1,$2)", [link, "b".repeat(32)]);
        await evidence();
        await accrue();
        const referrals = await scalar("select affiliate_partner_records($1,'referrals',0,'','',null,null)", [a]) as { merchant?: string; paid_conversion?: boolean }[];
        expect(referrals[0]?.merchant).toMatch(/^Merchant /);
        expect(JSON.stringify(referrals)).not.toMatch(/@|pay_test/);
        const commissions = await scalar("select affiliate_partner_records($1,'commissions',0,'','PAYABLE',null,null)", [a]) as { status?: string; commission_type?: string }[];
        expect(commissions[0]?.status).toBe("PAYABLE");
        expect(commissions[0]?.commission_type).toBe("recurring");
        const stats = await scalar("select affiliate_partner_link_stats($1)", [a]) as { code?: string; clicks?: number; conversions?: number }[];
        expect(stats[0]?.code).toBe("abcdefghijklmnopqrstuvwx");
        expect(Number(stats[0]?.clicks)).toBe(1);
        expect(Number(stats[0]?.conversions)).toBe(1);
    });
});
