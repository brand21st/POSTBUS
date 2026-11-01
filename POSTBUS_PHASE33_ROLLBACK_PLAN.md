# PHASE 3.3 — ROLLBACK / FORWARD RECOVERY

The eight files are **not** reversible in-place (immutable triggers, FKs, functions). There is no `DOWN` migration.

## If apply has not started

Do nothing. Current production is the rollback point.

## If apply fails mid-file

STOP. Capture `schema_migrations` / partial objects. Restore via **verified** PITR or snapshot to a time before `20261017120000`. Do not DROP live `razorpay_webhook_events`. Do not DELETE payments.

## If apply succeeds but app misbehaves

Keep flags false. Revert the **application** deploy. Leave additive schema in place unless it is proven to break billing (lease columns nullable; unused RPC is inert while flag is false).

## If affiliates flag was enabled in error

Set `POSTBUS_AFFILIATES_ENABLED=false` immediately so webhooks skip `claim_razorpay_webhook` if the RPC is missing or wedged.

This phase performed **no** restore and **no** apply.
