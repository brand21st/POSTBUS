# POSTBUS PHASE 3.2 — HOSTED RLS

Classification: **NOT STARTED** on hosted Supabase. **VERIFIED LOCALLY** only to the extent SQL policies exist in migrations and PGlite tests exercise grants.

PGlite is **not** hosted RLS.

Planned identities (Affiliate A/B, Merchant A/B, Platform Admin, Anonymous) were **not** created. Creating them would be a remote Auth/DB write.

Expected outcomes (to run after approval):

- Affiliate A cannot read Affiliate B.
- Affiliates cannot UPDATE/DELETE commissions.
- Merchant A cannot read Merchant B invoices.
- Ordinary merchants cannot approve partners.
- Authenticated users cannot insert verified tax evidence without privileged path.
- Anonymous cannot read private financial rows.
- Privileged `SECURITY DEFINER` RPCs reject unauthorized `auth.uid()`.

Until staging exists: **BLOCKED**.
