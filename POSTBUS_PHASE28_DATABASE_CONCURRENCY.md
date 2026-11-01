# PostBus Phase 2.8 database concurrency

Status: BLOCKED for multi-session proof.

`subscription_allocate_invoice_number` in `supabase/migrations/20261017140000_subscription_tax_invoices.sql` increments with:

`insert ... on conflict (series) do update set last_value = last_value + 1 returning last_value`

`invoice_number` and `payment_id` are unique. A second issue of the same payment returns the existing number when the gross amount matches.

PGlite proved that sequential behavior in one session: the first number was `PB/2026-27/000001`, the repeat returned the same number, and the row count stayed 1.

`Get-Command psql` and `Get-Command docker` returned no commands. No disposable PostgreSQL server was started. Two concurrent sessions were not opened. A single PGlite process is not a multi-session concurrency proof.

The numbering format remains the unapproved proposal `PB/2026-27/000001`.
