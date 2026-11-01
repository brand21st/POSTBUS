# PostBus affiliate staging architecture

Production and staging must be different Supabase projects. This repository does not contain a verified staging project ref. `supabase/config.toml` `project_id` is the local name `POST_BUS_APP`, not a hosted project.

Staging must use its own:

- Supabase URL and service role
- Razorpay test keys and webhook secret
- India Post test or stub credentials
- `POSTBUS_AFFILIATE_COOKIE_SECRET`

Staging must not use production service-role keys, live Razorpay keys, live India Post booking, or production customer rows.

Affiliate flags on staging stay unset until a person authorizes a staging test. The app code already treats any value other than `true` as off.

`scripts/affiliate-staging-gate.mts` calls `assertAffiliateStagingTarget`. It allows a remote migration only when `SUPABASE_PROJECT_REF` equals `AFFILIATE_STAGING_PROJECT_REF` and that ref is not listed in `POSTBUS_PRODUCTION_SUPABASE_REFS`. Missing values fail closed. A label such as `ENVIRONMENT=staging` is not an input to the gate.

This session ran the gate with those variables unset. It printed `{"ok":false,"reason":"staging_not_approved"}` and exited 1. No remote connection was opened.
