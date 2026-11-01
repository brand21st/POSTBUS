# Partner portal database

Existing unapplied files (order):

1. `20261017120000_affiliate_program.sql`
2. `20261017121000_affiliate_operations.sql`
3. `20261017122000_affiliate_webhook_leases.sql`
4. `20261017123000_affiliate_reporting.sql`
5. `20261017124000_affiliate_reconciliation.sql`
6. `20261017125000_affiliate_partner_portal.sql` (new, local only)
7. Tax files `20261017130000` and `20261017140000` remain required for commission tests, not for portal reads.

New objects in `20261017125000_affiliate_partner_portal.sql`:

- Columns on `affiliate_links`: `landing_path`, `utm_source`, `utm_medium`, `utm_campaign`.
- Check: landing_path in (`/`, `/pricing`, `/partner`).
- Function `affiliate_partner_link_stats(uuid)` service_role only.
- Replace `affiliate_partner_records` with PAID/UNPAID referral filters and `rate_basis_points` on commissions.

Not applied to production or staging. Remote project currently returns PGRST205 for `affiliate_settings`.
