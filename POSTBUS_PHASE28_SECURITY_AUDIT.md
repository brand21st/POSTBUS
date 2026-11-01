# PostBus Phase 2.8 security audit

Status: PARTIAL. Local grants and one cross-organization read are verified. Hosted RLS is UNVERIFIED.

Invoice writes stay on `service_role`. Authenticated select uses `subscription_invoice_org_visible`. Settings and counters stay revoked from `anon` and `authenticated`. Issued rows reject update and delete. Details are in `POSTBUS_PHASE27_SECURITY_AUDIT.md`.

This phase adds organization-scoped list filters. Search text is stripped to a safe character set before it is interpolated into a PostgREST `or` filter. The merchant route uses `ctx.organizationId`, not a client organization id. The admin organization filter accepts only a UUID-shaped value and still sits behind the platform-admin handler.

PDF responses are private and uncached. Profile edits require `org.billing`, which the role map gives to OWNER.

`proxy.ts` no longer matches `/_next/hmr` or `/_next/webpack-hmr`. Those paths are development sockets, not tenant pages. `allowedDevOrigins` is a development origin allowlist and does not change production headers. `upgrade-insecure-requests` remains in the CSP, including production.

No service-role key was added to a client bundle.
