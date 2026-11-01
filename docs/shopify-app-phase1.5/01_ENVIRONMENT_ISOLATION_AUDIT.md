# 01 Environment isolation audit

**Scope:** Classify local, staging-example, and production destinations. Mask secrets. No hosted writes.

**Classification:** PASS for isolation of this Phase 1.5 session (no production writes). Hosted staging: NOT APPLICABLE (no approved hosted staging project).

## Evidence

| Environment | Application URL | Database | Shopify public app | Flag | Jobs |
|-------------|-----------------|----------|--------------------|------|------|
| Local (this workspace) | `http://localhost:3000` (`.env.example`) | Dev Supabase placeholder `YOUR_PROJECT`; Vitest uses in-process PGlite, not production | Placeholders `SHOPIFY_PUBLIC_APP_*` empty; BYO `SHOPIFY_API_*` separate | `SHOPIFY_EMBEDDED_APP_ENABLED=false` | Local / not invoked |
| Staging example file | `http://127.0.0.1:3001` (`.env.staging.example`) | Placeholder `YOUR_ISOLATED_STAGING_PROJECT`; file comments forbid production ref `hgacoeoovjxkzfbesmvl` | Public-app placeholders empty; flag false | false | Staging stubs documented |
| Production (identified, **not used**) | `https://www.postbus.in` | Supabase project ref `hgacoeoovjxkzfbesmvl` (documented in `docs/merchant-api/PRODUCTION_MIGRATION_PLAN.md`) | Not configured for public embedded app in this phase | Must remain false | Untouched |

Secrets (service role, Partner secret, encryption key) were not printed.

A filename containing `staging` is **not** treated as a live staging database. `.env.staging.example` is a template. Docs (`docs/audits/POSTBUS_HOSTED_STAGING_SETUP_PLAN.md`) state there is **no approved hosted staging Supabase project**.

## Tests performed

- Did not apply `supabase db push`.
- Did not change production env.
- Isolated schema tests: PGlite only (`lib/shopify-app/provision.pg.test.ts`).

## Remaining blockers

- Partner client ID/secret not present locally (placeholders).
- Live Admin iframe requires Stage D approval.

## Recommendations

Keep production flag off. Apply the additive migration only to a proven non-`hgacoeoovjxkzfbesmvl` database after explicit authorization.
