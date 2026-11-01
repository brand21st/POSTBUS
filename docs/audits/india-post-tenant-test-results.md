# India Post Cross-Tenant Test Results

**Date:** 2026-10-22  
**Mode:** Isolated mocks / existing unit tests. No production merchant credentials. No live CEPT booking. No database writes.

**Harness:** `npx vitest run` on:

- `modules/india-post/provider.session.test.ts`
- `modules/india-post/session.test.ts`
- `modules/india-post/session-lock.test.ts`
- `modules/india-post/event-download-flags.test.ts`
- `lib/api/context.test.ts`
- `lib/api/v1/india-post-logout.test.ts`

**Result:** 6 files, **44 passed**, 0 failed. Duration ~24s.

Tests that would mutate production merchants or call live TNT/Event Download as those merchants were **not** run.

---

## TEST 1 — Organization A requests its token

| Field | Value |
| --- | --- |
| Method | Mocked `IndiaPostProvider` A with `encrypted_refresh_token` = refresh-a |
| Expected | Token A (`access-a`) |
| Actual | `sessionA.access_token === "access-a"` |
| Status | **PASS** |
| Evidence | `provider.session.test.ts` “does not share in-memory tokens across two connections” lines 565–591 |
| Runtime CEPT | NOT VERIFIED AT RUNTIME |

## TEST 2 — Organization B requests its token

| Field | Value |
| --- | --- |
| Method | Concurrent `Promise.all` with provider B / refresh-b |
| Expected | Token B (`access-b`) |
| Actual | `sessionB.access_token === "access-b"` |
| Status | **PASS** |
| Evidence | Same test |
| Runtime CEPT | NOT VERIFIED AT RUNTIME |

## TEST 3 — Organization A refreshes; B unchanged

| Field | Value |
| --- | --- |
| Method | Same concurrent AUTH02 mock: Authorization header selects access-a vs access-b |
| Expected | Only A’s access derived from refresh-a |
| Actual | A and B independently mapped; no shared module token |
| Status | **PASS** (in-memory). Live DB two-row refresh **NOT VERIFIED AT RUNTIME** |
| Evidence | Same test; persist uses `eq("id", connection.id)` (`session.ts` 16–18) |

## TEST 4 — Organization B booking uses Token B

| Field | Value |
| --- | --- |
| Method | Static: `runIndiaPostBooking` loads connection `eq organization_id`; `bookShipment` uses `this.connection.bulk_customer_id` and `this.token()` |
| Expected | Only B’s connection |
| Actual | No alternate-org select exists on this path |
| Status | **PASS** (code). Live booking **NOT VERIFIED AT RUNTIME** |
| Evidence | `booking-run.ts` 189–193, 366–368; `provider.ts` 299–318 |

## TEST 5 — Organization A accesses Organization B integration

| Field | Value |
| --- | --- |
| Method | `requireTenant` with `active_organization_id` org-other and no membership row |
| Expected | Access denied |
| Actual | `TENANT_ACCESS_DENIED` |
| Status | **PASS** |
| Evidence | `lib/api/context.test.ts` “rejects a user without membership in the active workspace” lines 115–144; RLS `is_org_member(organization_id)` |
| Note | Service-role workers bypass RLS but still query by job `organizationId`. Super-admin CEPT credential UI not present. |

## TEST 6 — Concurrent refresh A and B

| Field | Value |
| --- | --- |
| Method | `Promise.all([a.ensureSession(), b.ensureSession()])`; session lock unit test serializes **same** connection id |
| Expected | No cross-tenant overwrite |
| Actual | Distinct tokens; same-connection lock serializes workers |
| Status | **PASS** for isolation. Same-org persist without session lock on some booking/label paths is a **same-tenant** race (not this test’s failure). |
| Evidence | `provider.session.test.ts` 565–591; `session-lock.test.ts` “serializes two workers on the same connection id” |

## TEST 7 — Organization A integration missing

| Field | Value |
| --- | --- |
| Method | Static + logout/not-connected paths |
| Expected | Explicit failure; no fallback to B |
| Actual | `runIndiaPostBooking` throws “India Post is not connected.”; `indiaPostFromRow(null)` throws `INTEGRATION_NOT_CONNECTED`; tracking worker throws `PERMANENT_AUTH_ERROR` if no row; enqueue skips org without connection |
| Status | **PASS** |
| Evidence | `booking-run.ts` 194–196; `provider.ts` 630–634; `processor.ts` 744–746; `tracking-sync.ts` 163–165 |
| Live dual-org | NOT VERIFIED AT RUNTIME |

## TEST 8 — Background tracking worker processes A and B

| Field | Value |
| --- | --- |
| Method | Static review of `enqueueDueTrackingSyncJobs` loop and `syncTracking` |
| Expected | Each org uses its own credentials |
| Actual | Per-iteration `eq("organization_id", organizationId)`; job payload carries org id |
| Status | **PASS** (code) |
| Evidence | `tracking-sync.ts` 147–170; `processor.ts` 729–768 |
| Live worker trace | NOT VERIFIED AT RUNTIME |

## TEST 9 — Cache invalidation for A does not affect B

| Field | Value |
| --- | --- |
| Method | Key inspection |
| Expected | B remains unaffected |
| Actual | Tokens on distinct rows; `sessionTails` keyed by connection id; public live cache `${organizationId}:${barcode}` |
| Status | **PASS** |
| Evidence | `session.ts` 7, 43–45; `tracking-pages/public.ts` 68–69 |
| Caveat | Event Download `inflight` map keyed by **customer id** (IP-TAUTH-005). Invalidating A’s dates could coalesce with B if they share `bulk_customer_id`. |

## TEST 10 — Cross-tenant order/shipment ID injection

| Field | Value |
| --- | --- |
| Method | Static: booking and label fetches use `.eq("organization_id", organizationId).in/eq("id", shipmentId)` |
| Expected | Rejected before CEPT |
| Actual | Foreign UUID returns empty / not found; booking throws “Shipment not found.” |
| Status | **PASS** (code) |
| Evidence | `booking-run.ts` 198–204; `official-fetch.ts` 28–36 |
| HTTP IDOR suite | NOT VERIFIED AT RUNTIME beyond existing unit tests |

---

## Tests explicitly not executed

| Test | Reason |
| --- | --- |
| Dual real CEPT logins as two production merchants | Would use real merchant credentials and could rotate live refresh tokens |
| Production Event Download as 1392911671 | Out of scope; diagnostic already showed TNT 403 on a different API |
| Destructive webhook injection in production | Forbidden by audit rules |

---

## Mapping to scorecard

Isolated tests support **PASS** on access-token isolation, refresh isolation in memory, missing-connection fail-closed, and tenant membership denial. They do **not** by themselves prove Coolify allowlist contents or live Event Download HTTP status for any merchant.
