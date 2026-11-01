# PostBus P0 — India Post tracking API investigation

Read-only. No live CEPT call, no credential change, no migration, no deploy.
Reference AWB: `CX075364450IN`. Checked 18 Oct 2026 against production data and current source.

## Confirmed

- The shipment belongs to the connected production India Post account. Connection `environment` is `PRODUCTION`, `status` is `CONNECTED`, username, password, and access token are present. `bulk_customer_id` is `1392911671`. Active contracts: Business Parcel `41836561`, Speed Post inland parcel `41442557`. The connection row’s `contract_id` is null; booking uses the contract table, not that column.
- Shipment `CX075364450IN` is India Post, `MANIFEST_READY`, booked `2026-10-15 07:42:34Z`, `last_tracked_at` `2026-10-17 14:51:13Z`, `last_event_at` null, **0** `tracking_events`.
- Tracking uses `POST {production}/beextcustomer/v1/tracking/bulk` with `Authorization: Bearer` and body `{ bulk: string[] }`. The customer id and contract id are not sent. Production host is `app.indiapost.gov.in`.
- `token()` reuses a non-expired access token (60s skew) or logs in again. Login writes `expires_at`. The connection was refreshed at `2026-10-17 23:54:13Z` with expiry `2026-10-18 00:24:13Z`. Tracking jobs still failed `HTTP_403` until `2026-10-18 00:11:11Z`. A fresh login did not make tracking succeed.
- In the last 7 days, **260** tracking jobs for this organization failed `HTTP_403`. All 260 stored errors match “You are not authorized”. None match the sanitized app message, and none mention an expired token or an IP whitelist. Zero match the new progress payload: `progress` is `{}`.
- After the last stamp (`14:51Z`): 260 tracking `HTTP_403`, 1 tracking `PROVIDER_ERROR`, 1 booking `SUCCEEDED`, 3 booking failures `23505` (duplicate key). Booking uses the same bearer token against `POST /beextcustomer/process-articles/1392911671` and succeeded from the same application. The failure is specific to the tracking API.
- Jobs at `14:46`, `14:48`, and `14:50Z` are `SUCCEEDED` with an empty error and empty progress, and they left `last_tracked_at` set while zero events exist. Deployed code treats a completed job as success even when no article events were stored. The local routing fix that records `providerSyncOutcome` is not what production ran.

## Ruled out by this evidence

- Invalid or missing credentials. Login persisted a new token, and booking succeeded afterward.
- Expired access token as the cause of these 403s. Failures continued on a token that was still inside `expires_at`.
- Wrong environment host. The connection is `PRODUCTION`, and the same host accepted a booking.
- A single-AWB mismatch as the whole explanation. The organization has no stored tracking events, and the tracking call does not send a customer id; CEPT decides access from the token. One unauthorized token rejects every article in the batch.

## Still unverified

- The exact CEPT permission name behind “You are not authorized” (bulk tracking entitlement versus article ownership). The response body was not stored beyond that phrase. No live call was made.
- Whether tracking has a separate IP allowlist. A blanket block of this server is unlikely because booking succeeded from the same app, but a path-specific rule was not confirmed.
- What the pre-`14:51Z` HTTP 200 bodies contained. Those jobs stored no response and no progress, so empty history versus unmatched article cannot be distinguished.

## Required application action

Deploy the already-written tracking outcome fix so a job records `REJECTED` versus `EMPTY_ACCEPTED` and does not report a successful sync when the provider rejects the chunk. That fix does not create scans while CEPT returns 403. No further code change is justified by this investigation.

## CEPT question

On production `POST /beextcustomer/v1/tracking/bulk`, customer `1392911671` (contracts `41836561` and `41442557`) receives HTTP 403 “You are not authorized” for article `CX075364450IN` and for the rest of that customer’s bulk requests. Login and `POST /beextcustomer/process-articles/1392911671` succeed with the same account. Please confirm whether bulk tracking is entitled for this customer, and whether that 403 is missing API permission, article ownership, or an IP restriction on the tracking path only.
