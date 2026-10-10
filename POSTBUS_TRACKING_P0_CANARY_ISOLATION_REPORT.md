# POSTBUS Tracking P0 — Canary Isolation

## Verdict: GREEN (disabled-by-default)

A global shared worker without a gate would have been **CANARY ISOLATION NOT PROVEN**. That was true of the first local P0 worker. This candidate adds an explicit gate.

## Mechanism (least invasive)

Coolify/env (read at runtime for org/AWB lists):

| Variable | Default | Effect |
|---|---|---|
| `INDIA_POST_TRACKING_P0_CANARY_ORGANIZATION_ID` | empty | P0 ingest **off**; fleet legacy |
| `INDIA_POST_TRACKING_P0_CANARY_AWBS` | empty | Canary org enqueued/query **blocked** until set |
| `INDIA_POST_TRACKING_P0_CANARY_SIDE_EFFECTS` | `off` | No Shopify/WhatsApp from P0 apply |

Enforced at:

- **Scheduler** `enqueueOrgTrackingSyncIfIdle` — canary org without allowlist → `canary-awaiting-allowlist`
- **Worker** `runOrganizationTrackingSync` — non-canary → `isolateFailures: false`; canary → filter rows to allowlist, max 5, isolate on, skip side effects
- **Manual** `syncNdrShipment` — canary org + off-list AWB → 400 validation, **no CEPT**
- **Retry** — same `processJob("tracking-sync")` path
- Credentials — one `india_post_connections` row per org; never mixed

Other merchants keep automatic tracking (legacy). They are **not** silently disabled.

## First deploy must not arm the canary

Leave canary env empty so production behavior matches `865d295` tracking-sync aside from auth cooldown / due-shipment enqueue skips (protective, no extra CEPT isolation calls).

## Live CEPT

**NOT EXECUTED — APPROVAL REQUIRED** (org id + ≤5 AWBs + call budget).
