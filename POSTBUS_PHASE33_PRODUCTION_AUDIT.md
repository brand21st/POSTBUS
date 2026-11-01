# POSTBUS PHASE 3.3 — PRODUCTION AUDIT (READ-ONLY)

Date: 17 Oct 2026. Phase A only. **No production writes.**

Owner decision: use existing production Supabase `hgacoeoovjxkzfbesmvl` instead of a separate staging project. That decision **does not** authorize migrations, deploys, or flag changes.

## Identity (verified)

MCP `get_project_url` → `https://hgacoeoovjxkzfbesmvl.supabase.co`

PostgreSQL: **17.6** (x86_64-pc-linux-gnu).

Supabase branches: none.

Last applied hosted migration: `20261016005144` `order_india_post_estimate_key`.

No `20261017*` affiliate/tax migrations in hosted history.

## Live inventory (counts, read-only)

Organizations 53, members 53, orders 6951, shipments 1520, subscriptions 53, payments 25, `razorpay_webhook_events` **4 (all `processed`)**, plans 3, `platform_admins` 1, `billing_audit_logs` 126, `background_jobs` 91133.

Affiliate objects: `affiliate_profiles`, `affiliate_commissions`, `subscription_tax_policies`, `subscription_tax_invoices` → **null** (`to_regclass`).

## Compatibility positives

- `create_organization_for_user(p_name text)` exists (required by `affiliate_create_organization`).
- `payments` has `organization_id`, `subscription_id`, `billing_cycle`, `currency`, `amount_paise`, `razorpay_payment_id`.
- `razorpay_webhook_events` has unique `event_id`; lease columns **absent** (expected until 122000).
- `billing_audit_logs` columns and `actor_type` check match the `IF NOT EXISTS` definition in 130000.
- Catalog Business monthly **₹3,500** (`350000` paise), yearly **₹33,600**. Seed ₹5,500 was **not** applied. **BUSINESS_PRICING_DECISION_REQUIRED** (no price change this phase).

## Classification

PRODUCTION READ-ONLY AUDITED. **NOT DEPLOYED.**
