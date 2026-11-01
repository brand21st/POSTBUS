# PostBus India Post Integration Audit

**Status:** READ-ONLY — no CEPT requests, no bookings, no credentials printed  
**Date:** 2026-10-20

---

## Documentation

| Document | Status |
|----------|--------|
| India Post External Integrations Approach Document (PDF) | **PENDING / not in repository** |
| Code citation | `modules/india-post/spec.ts` L1: “updated **30.07.2026**” |
| Derived mapping | `modules/india-post/mapping-table.md` |
| UAT report | `docs/PostBus-India-Post-UAT-API-Test-Report-2026-09-20.{html,pdf,docx}` |
| Internal audits | `docs/audits/POSTBUS_INDIA_POST_*.md`, tracking audits |

Treat Approach PDF verification as **REQUIRES EXTERNAL VALIDATION**. Limits in `spec.ts` are the in-repo source of truth until the PDF is attached.

Limits (**VERIFIED** `spec.ts`):

- Bulk reference max 50  
- Tracking bulk 500  
- JSON booking max 999  
- File booking max 5000  
- Address line 80 / combined 240  
- Dimension abs max 150 cm  

---

## Capability matrix

| Capability | Implemented? | Evidence | Shopify reuse |
|------------|--------------|----------|---------------|
| Access token login | Yes | `provider.ts` login/refresh; `session-tokens.ts` `/access/TokenWithRtoken` | Backend only |
| Token cache | Yes | 60s skew; DB session lock TTL 25s | Backend only |
| Pincode / offices | Yes | `validateShipment`, `searchPostOffices` | Via `/api/v1` |
| Tariff | Yes, **flagged** | `INDIA_POST_TARIFF_QUOTES_ENABLED` default false | Via API |
| JSON booking | Yes | `POST …/process-articles/{customerId}` timeout **10s** | `createShipmentsForOrders` |
| File/bulk booking | Yes, **off by default** | `INDIA_POST_BULK_ENABLED` default `false`; concurrency 1 | Same workers |
| Label PDF | Yes | `POST /v1/label/create/domestic` | Label jobs |
| Single + bulk track | Yes | bulk chunk 500 | `tracking-sync` |
| Event mapping | Yes | `event-mapper.ts` NDR/RTO phrases | Tracking UI |
| Inbound tracking webhooks | Code **quarantined** | `isIndiaPostWebhookQuarantined() → true`; always `{ quarantined: true }` | Polling is live path |
| Cancel article | Not supported | `provider.ts` throws/not implemented | N/A |
| CEPT barcode allocate | Not via provider | Local `allocate_barcode_serial` | Required onboarding |

---

## Credentials and environments (**VERIFIED**)

Stored on `india_post_connections` (encrypted username/password/tokens via AES-256-GCM `lib/security/crypto.ts`). Also: `bulk_customer_id`, `contract_id`, pickup/dropoff office IDs. Per-service `india_post_contracts`.

Hosts: UAT `test.cept.gov.in`, PROD `app.indiapost.gov.in`. Staging runtime **forbids** live hosts (`modules/india-post/environment.ts`). Connection environment `PRODUCTION` | `UAT`.

IP allowlisting: **UNKNOWN** in app code (CEPT-side). Merchants must still configure CEPT customer ID/password; PostBus does not impersonate India Post.

---

## Idempotency and AWB (**VERIFIED**)

`modules/india-post/booking-idempotency.ts`:

- Authoritative if `booked_at` **or** accepted status + barcode  
- `BOOKING` / `RECOVERY_REQUIRED` without `booked_at` = **unknown**  
- `canRetryCeptPostAfterUnknown()` **always false** — no blind second POST  
- Retry only if tracking **confirms not booked**  
- Duplicate CEPT article messages mapped  

Org booking lock: `acquire_india_post_booking_lock` TTL 45s (`booking-lock.ts`). Session lock TTL 25s.

Barcode: RPC `allocate_barcode_serial` CAS; unique `shipments_org_barcode_uidx`. Production blocks CEPT UAT test series 21433001–21434000.

**Residual risk (**documented**):** timeout after CEPT accepted the article but response lost — shipment stays `RECOVERY_REQUIRED`. `infra/HOSTINGER.md` notes this. Shopify UI must **reconcile, not re-book**.

Partial bulk: `PARTIAL_SUCCESS` with per-article booked/failed IDs (`bulk-worker.ts`).

---

## Shopify frontend rule

**The Shopify embedded UI must never call India Post.** All traffic: App Home → PostBus BFF (`requireShopifyTenant`) → `modules/india-post` → CEPT.

Contract-specific article types: bookable codes `SP_INLAND_PARCEL`, `BUSINESS_PARCEL` (`types/domain.ts`). Legacy `SP_INLAND_DOC` label only. OTP-gated `24_SPP_PARSPL` helper exists in `spec.ts` — **PARTIALLY VERIFIED** whether any merchant uses it.

Weight/dimension validation lives in booking payload + `booking-dimensions` tests. COD: `codr_cod` + `value_for_codr_cod` (`booking-payload.ts`). Pickup/dropoff office APIs exist on integrations routes.

Tracking event order: rank-gated `STATUS_RANK` in `event-mapper.ts`. Dedup: tracking apply module + inbox jobs. Tenant ownership: queries scoped by `organization_id` / barcode uniqueness per org.

**Entire India Post business layer is reusable** for Shopify. UI is not.
