# PostBus India Post booking safety report

Date: 2026-10-30  
CEPT target: `http://127.0.0.1:4099` only. Live CEPT was not called.

## Provider mode

Stub `/health`: `provider_mode: STUB`. Staging `INDIA_POST_*_BASE_URL` hosts are `127.0.0.1:4099`. Runtime identity on 3001 reports the same hosts. `productionSupabaseDetected: false`.

## App booking E2E

**Not executed.** Manual / bulk / automatic / worker booking through Next on 3001 requires Auth, org membership, and PostgREST. Those services are not running.

Synthetic `POST /book` on the stub returned `{ success: true, stub: true }`. That proves the stub process, not `runIndiaPostBooking` persistence.

## In-process tests (this session)

After fixing `booking-idempotency.test.ts` fixtures (`address_validation_status: READY` on bookable rows) and aligning TEST 9 with fail-closed `{ failedIds }` instead of an uncaught throw:

- `modules/india-post/booking-idempotency.test.ts` — 28 passed
- `booking-dimensions.test.ts`, `article-validator.test.ts`, `barcode.test.ts`, `cept-local-stub.test.ts`, `booking-safety.pg.test.ts` (PGlite lock), `bulk-booking-safety.test.ts` — included in the 284-pass focused run

Observed safety behavior in code/tests:

- INVALID / missing READY address: no CEPT POST (`bookShipmentMock` not called).
- Already BOOKED: zero CEPT calls.
- Invalid PIN in TEST 9: failed result, then retry after a valid READY address books once.

## Barcode

Staging booked fixture: `ET214330016IN` on `shipments.status = BOOKED`. Application barcode allocation against production ranges was not invoked. PGlite booking-lock tests are not the 55432 cluster.

55432 `shipments` has no barcode-range tables from the full Supabase migration set. **Barcode isolation vs production ranges is unproven on this cluster.**

## Sequence vs application

The required LOAD ORDER → ownership → address → booking status → idempotency → allocate → CEPT stub → store path was **not** run as an authenticated HTTP flow.

## Gate

**India Post mock booking E2E: FAIL** as an application flow.  
**CEPT stub isolation: PASS.**  
**Unit / PGlite booking gates: PASS** after test fixture alignment.
