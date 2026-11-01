# PHASE 3.3 — DATABASE SCHEMA REVIEW

Production public schema includes shipping, billing, storefront, AI, print, support. RLS enabled on listed application tables.

Affiliate/tax schema is **not installed**.

Dependencies the eight files assume:

| Object | Production |
| --- | --- |
| `auth.users` | present (Auth) |
| `organizations` / `organization_members` | present |
| `create_organization_for_user(text)` | present |
| `payments` / `subscriptions` | present |
| `platform_admins` | present (1 row) |
| `razorpay_webhook_events` | present, 4 processed rows |
| `billing_audit_logs` | present; 130000 uses `IF NOT EXISTS` |

No destructive SQL in the eight files (`DROP TABLE` / `TRUNCATE` / `DELETE FROM` / unconstrained `UPDATE` of merchant data). `20261017125000` uses `drop constraint if exists` only on `affiliate_links` after that table is created in the same chain.

PGlite rehearses this chain against a **simplified** org/payment fixture. That is **not** production PostgreSQL 17 verification of locks or planner behavior.
