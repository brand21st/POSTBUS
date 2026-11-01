# Partner portal audit

Classification uses COMPLETE, PARTIAL, MISSING, BROKEN, UNVERIFIED.

| Area | Status | Evidence |
| --- | --- | --- |
| Affiliate engine (profiles, links, clicks, attribution, commissions, ledger) | COMPLETE locally | `supabase/migrations/20261017120000_affiliate_program.sql` through `20261017124000_affiliate_reconciliation.sql`. PGlite: `modules/affiliates/ledger.pg.test.ts`. |
| Feature flags | COMPLETE | `POSTBUS_AFFILIATES_ENABLED`, `POSTBUS_AFFILIATE_ACCRUAL_ENABLED`, `POSTBUS_AFFILIATE_PAYOUTS_ENABLED` in `modules/affiliates/policy.ts`. Production flags were not changed. |
| Partner login / register | PARTIAL | Routes exist. Password min 10 via public POST. Origin now accepts localhost and 127.0.0.1 (`lib/security/origin.ts`). Browser login 17 Oct 2026 succeeded for `Post@post.com`. |
| Partner dashboard UI | PARTIAL | Replaced tabbed page with shell routes. Live DB lacks affiliate tables (`PGRST205`), so dashboard cannot load real metrics against the current remote project. |
| APIs `/api/partner/*` | PARTIAL | Existing catch-all plus aliases `dashboard`, `analytics`, `campaigns`. Service-role scoped to session profile. |
| Campaign UTMs / landing pages | PARTIAL | Local migration `20261017125000_affiliate_partner_portal.sql` + `campaignLinkSchema`. Not applied remotely. |
| QR | COMPLETE in code | `app/api/partner/qr/route.ts` encodes owned enabled codes only. Browser download unverified because links cannot load without tables. |
| Referrals / commissions lists | COMPLETE in SQL | `affiliate_partner_records` statuses PENDING, PAYABLE, PAID, REVERSED. Merchant display is `Merchant ` + 8 hex chars. |
| Payouts UI | COMPLETE as disabled | POST payouts still require `POSTBUS_AFFILIATE_PAYOUTS_ENABLED`. Screen states requests are not available. |
| Super Admin affiliates | COMPLETE in code | `app/(admin)/admin/affiliates/page.tsx`. Same tables. |
| Remote schema | BROKEN for portal data | `affiliate_settings` / `affiliate_profiles` missing on `hgacoeoovjxkzfbesmvl.supabase.co`. No remote SQL was run. |
| Unique visitors | COMPLETE | Distinct `affiliate_click_events.visitor` in `affiliate_summary`. Visitor is cookie id, not a person and not IP. |

Do not treat a rendered empty card as financial completeness. Authoritative numbers require the unapplied migrations on an authorized database.
