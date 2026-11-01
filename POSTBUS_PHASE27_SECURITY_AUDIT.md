# PostBus Phase 2.7 security audit

Status: PARTIAL. SQL grants and one cross-organization read were verified in PGlite. Hosted Supabase RLS was not executed.

## Controls in the migration

- `subscription_allocate_invoice_number`, `subscription_issue_tax_invoice`, and `subscription_invoice_reconcile` are revoked from `public` and granted to `service_role`.
- `subscription_issue_tax_invoice` also requires a `platform_admins` row for the actor.
- Authenticated users can select `subscription_tax_invoices` only when `subscription_invoice_org_visible` finds their membership. The check is security definer so the policy does not read `organization_members` as the caller.
- Settings, counters, and billing profiles are revoked from `anon` and `authenticated`.
- Issued invoices reject update and delete.
- Invoice numbers and payment ids are unique.
- PDF responses are private and not stored in a shared cache.

## Application controls

Merchant routes use `ctx.organizationId`. The PDF payment id must be a UUID. Admin routes use the existing platform-admin gate, and settings or issuance also require the action PIN. Issuance is recorded in `billing_audit_logs`. The issuance flag is read on the server. The service-role key is not added to a frontend bundle.

## Local proof

In PGlite, a non-admin actor cannot issue, an empty supplier GSTIN cannot issue, a payload whose organization does not own the payment cannot issue, and an authenticated member of another organization selects zero invoice rows. A second issue of the same payment returns the same number and leaves `payments.amount_paise` at 149900. Updating `gross_paise` raises.

## Not verified

Hosted RLS, signed storage URLs, and a logged-in browser session were not tested. PDFs are streamed from the authenticated API rather than written to a public bucket. Two concurrent sessions were not used to stress the counter. The counter statement itself is an atomic upsert.
