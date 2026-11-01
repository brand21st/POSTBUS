# PostBus Database Architecture

**Status:** READ-ONLY (migrations inspected; **no SQL executed against production**)  
**Date:** 2026-10-20  
**Source:** `supabase/migrations/*.sql` (129 files in main tree)

---

## 1. Tenant model (**VERIFIED**)

```
auth.users
    └── profiles (active_organization_id)
            └── organization_members (role) ── organizations
                     │
                     ├── orders / shipments / labels / …
                     ├── shopify_connections (1:1 org today)
                     ├── india_post_connections (1:1 org)
                     └── subscriptions / billing_usage
```

RLS: `is_org_member(org_id)` (`20260919090000_init_enums_identity.sql`), `has_org_role(org_id, roles[])` (`20260920190000_role_aware_rls_and_webhook_secrets.sql`). Anon revoked from `has_org_role`.

**Service-role bypasses RLS.** Used by jobs, Merchant API, some RPCs. Isolation then depends on application filters. Merchant API order get **does** filter `organization_id` (`modules/orders/service.ts`). A missed filter would be CRITICAL.

---

## 2. Actual tables by domain

Names below are **VERIFIED** from migrations. Not every column is listed.

### Identity / tenancy

`profiles`, `organizations`, `organization_members`, `organization_invites`, `organization_policies`, `platform_admins`, `user_table_layouts`, `otp_challenges`, `otp_rate_buckets`, `phone_identities`, `auth_audit_events`

### Shopify

`shopify_connections`, `shopify_stores`

Unique indexes (**existing, not a proposal**):

- `shopify_connections_one_per_org` (`organization_id`)
- `shopify_connections_one_per_shop` (`lower(shop_domain)`)

`20260925140000_shopify_one_shop_per_org.sql`

### Commerce / shipping

`customers`, `addresses`, `pickup_locations`, `orders`, `order_line_items`, `external_order_references`, `shipments`, `shipment_packages`, `labels`, `label_templates`, `label_sheet_members`, `manifests`, `manifest_shipments`, `tracking_events`, `tracking_pages`, `tracking_page_banners`, `shipment_counters`, `order_payment_claims`, `customer_order_links`, `user_shipment_presets`

Notable uniques:

- orders `(organization_id, source, source_order_id)`
- shipments `(organization_id, barcode)` `shipments_org_barcode_uidx`

Orders extra COD: `orders.extra_cod_charge` (`20261015151112_order_extra_cod_charge.sql`).

### India Post

`india_post_connections` (unique `organization_id`), `india_post_contracts`, `barcode_ranges` (active-per-service unique), `india_post_bulk_batches`, `india_post_bulk_batch_articles`

RPCs: `allocate_barcode_serial` **service_role only**; booking/session lock RPCs (`20261008020000_india_post_booking_lock.sql`, `20261019150000_india_post_session_lock.sql`).

### Billing / payments (platform)

`plans`, `platform_settings`, `subscriptions`, `subscription_items`, `payments`, `billing_usage`, `razorpay_customers`, `razorpay_webhook_events`, `subscription_history`, `billing_audit_logs`, `trial_claims`, `usage_events`, `subscription_tax_policies`, `subscription_tax_breakdowns`, `subscription_tax_invoices`, `addon_catalog`, `organization_addon_subscriptions`, `organization_entitlements`

RPC: `consume_order_quota(p_org, p_quantity)` (`20261006140001_consume_order_quota_quantity.sql`).

**No** `provider` column for Shopify Billing today (**VERIFIED** absence of Shopify charge GIDs in current billing modules). Adding it is a **PROPOSAL**.

### AI

`ai_credit_packages`, `ai_credit_ledger`, `ai_image_sessions`, `ai_image_jobs`, `ai_image_assets`, plus accountant tables from `20261019120000_paid_addons_ai_accountant.sql`. Org balance column `organizations.ai_credits_balance`. RPCs `consume_ai_credit`, reserve/finalize/release.

### Support / notifications

`support_*` family (`20261009140000_support_center.sql` + identity/dual WhatsApp migrations), `whatsapp_support_sessions`, `notifications`, `vachat_connections`, `vachat_notification_logs`, `vachat_webhook_envelopes`

### Automation / jobs / print

`automation_settings`, `background_jobs`, `shipment_job_attempts`, `idempotency_keys`, `print_settings`, `print_agents`, `print_jobs`, `printers`, `print_devices`, `print_pairing_challenges`, `print_device_sessions`, `print_device_events`

### Webhooks / API / audit

`api_keys`, `webhook_endpoints`, `webhook_deliveries`, `webhook_events`, `provider_webhook_inbox`, `merchant_api_request_logs`, `merchant_api_rate_buckets`, `audit_logs`

### Inventory / storefront / affiliates / tutorials / shipping invoices

See `POSTBUS_CURRENT_ARCHITECTURE.md` module list. Tables: `products`, `inventory_*`, `storefront_*`, `affiliate_*`, `tutorial_*`, `invoice_settings`, `invoice_counters`, `shipping_invoices`.

---

## 3. Isolation evaluation

| Concern | Finding |
|---------|---------|
| Org isolation | Strong when using user-scoped client + RLS |
| Composite FKs | Typical `(id)` PKs + `organization_id` columns; **not** composite PK tenant pattern |
| Tenant ownership validation | App + RLS; service-role paths must always `.eq("organization_id")` |
| Transaction handling | Booking claim CAS + locks; quota RPC `FOR UPDATE` |
| Indexes | Broad org-scoped indexes; Merchant API cursor index `orders_org_updated_id_idx` |
| Query performance | **NOT MEASURED** in production |
| Migration safety | Additive style historically; Shopify install tables must be additive |

---

## 4. PROPOSED shop-to-organization model (do not apply)

**Current:** 1 org ↔ 1 Shopify shop.

**Proposal for embedded app:**

```
Shopify Shop (shop_domain globally unique)
    └── shopify_installations  (PROPOSED new table)
            └── organizations
                    └── orders / shipments / settings
```

Rules:

1. **Never** auto-link by email.  
2. Linking an existing org requires an authenticated OWNER of that org **and** proof of shop install (verified ID token / offline token for that `dest`).  
3. Keep `shop_domain` globally unique.  
4. Multi-shop per org: **optional later** — would require dropping `shopify_connections_one_per_org`. MVP should keep 1:1 to match current unique indexes and `maybeSingle()` loaders.  
5. Shop changing org: **disallowed** unless Super Admin + dual confirmation; prevents takeover.  
6. Headless org (`origin=SHOPIFY`, nullable `created_by`) needs RLS redesign: embedded requests cannot use `auth.uid()`. Use **tenant-scoped service-role wrapper** that **requires** `organizationId` on every `from()` (**PROPOSAL**, existing plan). Ship with a test that a cross-tenant read throws.

Proposed columns (documentation only): `organizations.origin`, `claimed_at`; `subscriptions.provider` (`RAZORPAY`|`SHOPIFY`); `shopify_installations` encrypted token, scopes, status, uninstall timestamps; `shopify_compliance_requests` for GDPR.

---

## 5. Constraints that prevent cross-tenant access (existing + proposed)

Existing:

- Unique shop domain  
- Unique org Shopify connection  
- Order unique per source id  
- Barcode unique per org  
- RLS member checks  

Proposed:

- Installation row FK to org  
- BFF resolves org **only** from verified shop claim, never from client-supplied org UUID  
- Reject requests whose JWT `dest` shop does not match installation  
