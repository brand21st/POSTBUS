# POSTBUS India Post Tariff API Audit

Status: read-only architecture audit. No code, database, configuration, booking, webhook, or deployment changes were made.

Evidence is from the repository as inspected on 15 October 2026. Worktrees were ignored. The official query and response fields below come from the task specification (India Post External Integrations Approach Document, sections 1.1, 1.3.1, 1.3.2, and tariff validation rules). Undocumented India Post behavior is marked OPEN or UNKNOWN.

## Section 1 — Executive summary

PostBus already books Speed Post and Business Parcel, stores the tariff India Post returns **after booking**, and has one unused Speed Post tariff method. It does not call the Business Parcel tariff API, does not expose a merchant “calculate shipping” action, and does not persist a pre-booking quote.

The existing India Post login, encrypted credentials, and per-organization connection can be reused. They must not be copied into a second client. The unused `getTariff` method is not safe to wire as-is: it always hits Speed Post, omits dimensions, insurance, and POD, and defaults a missing weight to 100 g.

Recommended trigger: explicit user action, or the moment immediately before booking, for one selected service. Do not call the tariff API on every Shopify sync. Bulk quotes, if added later, must be application-level orchestration of the documented single-article GET endpoints, with a low concurrency cap and no booking side effects.

Contract-specific discounted rates are an OPEN QUESTION. The supplied tariff specification does not prove that the response is the merchant’s contracted price.

## Section 2 — Current application architecture

| Item | Evidence |
|---|---|
| Framework | Next.js `16.3.8`, React `19.2.8`, TypeScript `^5` (`package.json`) |
| API style | Route handlers under `app/api`, dispatched by `lib/api/v1/commerce.ts` and `lib/api/v1/integrations.ts` |
| Server Actions | NOT FOUND (`"use server"` has no matches) |
| Database | Supabase / PostgreSQL. Migrations in `supabase/migrations`. Tenant key is `organization_id` |
| Auth | App session resolves a `TenantContext` with `organizationId`. India Post uses a separate CEPT login |
| Jobs | `background_jobs` table (`20260919090200_integrations_platform.sql` lines 78–80) and `workers/processor.ts` |
| Deploy | Coolify-hosted Next.js app. Not exercised in this audit |

Orders, shipments, labels, tracking, COD collection, Shopify sync, and bulk booking exist and are used in production paths. “Exists” does not mean every edge case is correct; this audit only traces the paths relevant to tariff.

## Section 3 — Existing India Post integration

| Capability | Status | Evidence |
|---|---|---|
| Access token login | VERIFIED | `IndiaPostProvider.login` → `POST .../v1/access/login` (`modules/india-post/provider.ts` lines 65–97) |
| Speed Post / Business Parcel booking | VERIFIED | `bookShipment` posts articles to `process-articles/{customerId}` (`provider.ts` lines 196–214; URL at `endpoints.ts` lines 44–47) |
| Article type mapping | VERIFIED | `SP` / `SP_INLAND_PARCEL` book as `SP_INLAND_PARCEL`; `BP` books as `BUSINESS_PARCEL` (`endpoints.ts` lines 75–80) |
| Barcodes, labels, tracking, bulk booking | VERIFIED as existing modules | `modules/india-post/barcode.ts`, `modules/labels/*`, `provider.trackShipment`, `modules/india-post/bulk-engine.ts` |
| Speed Post tariff GET | PARTIALLY VERIFIED | Method exists and is **never called** (`provider.ts` lines 153–170; repo-wide `getTariff(` callers: the interface and the method only) |
| Business Parcel tariff GET | NOT FOUND | No `business-parcel-tariff` string in application code |
| Post-booking tariff | VERIFIED | Booking response `calculated_tariff` is stored on `shipments.tariff_amount` (`modules/india-post/booking-apply.ts` lines 11–28; `booking-run.ts` lines 68–83) |

Product code and booking article type are not interchangeable:

- Tariff query `product-code=SP` is the documented Speed Post tariff selector.
- Booking `article_type` is `SP_INLAND_PARCEL` or `SP_INLAND_DOC` (`endpoints.ts` lines 56–80).
- Tariff query `product-code=BP` is the documented Business Parcel selector.
- Booking `article_type` is `BUSINESS_PARCEL`.
- A sample tariff response field `product_code=BUSINESS_PARCEL` must not be sent back as the request `product-code` without a documented example. OPEN: confirm the request code remains `BP`.

## Section 4 — Authentication and token management

VERIFIED:

1. One `india_post_connections` row per organization (`organization_id uuid not null unique`, migration `20260919090200_integrations_platform.sql` lines 29–48).
2. Username, password, access token, refresh token, and id token are stored encrypted (`encrypted_*` columns). `encryptSecret` / `decryptSecret` wrap them (`provider.ts` lines 73–74 and 107–114; `lib/security/crypto`).
3. `GET integrations/india-post` selects the row but returns a masked payload: `usernameMasked`, `hasPassword`, customer id, contract id, offices. It does not return tokens or the password (`lib/api/v1/integrations.ts` lines 621–658).
4. RLS: members can select their org row; only OWNER/ADMIN can write it (`20260920190000_role_aware_rls_and_webhook_secrets.sql` lines 67–75).
5. `token()` reuses a cached access token only when `expires_at` is more than 60 seconds in the future. Otherwise it calls `login()` again (`provider.ts` lines 122–131).
6. A successful login is persisted by `persistIndiaPostTokens` (`modules/india-post/session.ts` lines 7–32). Tracking and booking session helpers serialize login per connection (`withProcessSessionLock`, lines 35–54).
7. Login uses a 20 second timeout (`modules/india-post/http.ts` lines 1–6). HTTP 401 is marked `PERMANENT_AUTH_ERROR` (`provider.ts` lines 82–87).

PARTIALLY VERIFIED:

- The refresh token is stored. No refresh-token HTTP call was found. Expiry is handled by a full username/password login, not by a refresh grant.
- The 15-minute lifetime is whatever `expires_in` India Post returns. The code does not hard-code 15 minutes. If `expires_in` is wrong, the 60-second skew will not correct it.
- `rememberSession` updates the in-memory connection. Persistence happens only on the paths that call `persistIndiaPostTokens`. A future tariff caller must use `ensurePersistedIndiaPostSession` or an equivalent, or each process will re-login.

UNVERIFIED: whether service-role workers bypass RLS when loading the connection. Booking workers load the connection server-side by organization. That is required for jobs, and it is also the place a missing `organization_id` filter would leak credentials. Tariff jobs must take the same organization-scoped load used by booking.

Credentials in logs: login throws `json.message`, not the token (`provider.ts` lines 82–87). A tariff client must not log `Authorization` or decrypted secrets. Current `getTariff` does not log the request.

## Section 5 — Order data availability

| Field | Manual order | Shopify order | Notes |
|---|---|---|---|
| Order id / organization id | VERIFIED | VERIFIED | `orders.organization_id` |
| Source | `MANUAL` | `SHOPIFY` | `orders.source` |
| Receiver pincode | VERIFIED | VERIFIED | Shipping address `pincode` |
| Sender pincode | PARTIAL | PARTIAL | Connection `pickup_office_pincode` or `pickup_dropoff_office_pincode`. Not an order column |
| Physical weight | Form grams, or parcel override | Line `weight_grams` plus parcel override | Integer grams required by `toIndiaPostPhysicalWeightGrams` (`weight.ts` lines 4–8) |
| L / W / H | Shipment form and workspace defaults | Same shipment fields; not verified as Shopify metafields | Metafield dimensions: NOT FOUND |
| Service | `SP_INLAND_PARCEL` or `BUSINESS_PARCEL` (`booking-service.ts` lines 3–10) | Workspace default or order override | |
| Contract / customer id | Connection, not the order | Same | `bulk_customer_id`, service contracts table |
| COD collection | `orders.cod_amount` plus `extra_cod_charge` | Shopify payment mapping into `cod_amount` | This is collection, not India Post’s COD fee |
| Insurance | Booking payload supports DOP insurance (`booking-payload.ts`) | Same | No required insurance field on the manual order form |
| Customer shipping charge | Not entered on the manual form | `orders.shipping_amount` from Shopify `total_shipping_price_set` (`modules/shopify/orders.ts` line 2134) | |
| Booking tariff | Empty until booking | Empty until booking | `shipments.tariff_amount` |

Missing weight or dimensions is a known booking blocker. Tariff must fail closed on those inputs rather than using `getTariff`’s default weight of 100 (`provider.ts` line 157).

Volumetric weight already exists for labels and booking checks: `ceil(L × W × H / 5)` grams (`endpoints.ts` lines 263–266). Chargeable weight is `max(physical, volumetric)` (`weight.ts` lines 10–22). Whether India Post’s tariff API applies the same divisor is OPEN. PostBus should send physical weight and dimensions, then display the API’s `chargeable_weight`. It should not replace the API weight with the local estimate.

## Section 6 — Existing shipping charge logic

These values already have different homes. A tariff quote must not overwrite them.

| Concept | Current storage | Meaning |
|---|---|---|
| Customer shipping charge | `orders.shipping_amount` | What the merchant charged the buyer. Shopify sets it. Manual orders leave the column at its default 0 |
| India Post booking tariff | `shipments.tariff_amount` | `calculated_tariff` from a successful or partial booking response |
| COD collection | `orders.cod_amount`, copied to `shipments.cod_amount` | Amount India Post is told to collect. Includes manual extra COD. Not an India Post fee |
| Extra COD charge | `orders.extra_cod_charge` | Merchant collection add-on. Explicitly excluded from tariff |
| Insurance | Booking article fields when DOP is selected | Not a stored quote |
| GST / VAS | NOT FOUND as order columns | Only inside a tariff or booking response |
| Local volumetric estimate | UI and label helpers | Display only |

`getTariff` does not write any of these. Booking does write `tariff_amount`. A pre-booking quote must use a different column or table so a failed quote cannot clear a booked tariff.

## Section 7 — Speed Post tariff analysis

Documented call: `GET {base}/beextcustomer/v1/speed-post/tariffs` with Bearer token and query keys `product-code`, `weight`, `source-pincode`, `destination-pincode`, `length`, `width`, `height`, `INS`, `POD`.

Current method (`provider.ts` lines 153–170):

- Builds only `product-code` (default `SP`), `weight` (default `100`), and the two pincodes.
- Does not send `length`, `width`, `height`, `INS`, or `POD`.
- Uses the session host for UAT or production, so the path matches the documented `/v1/speed-post/tariffs` shape (`endpoints.ts` lines 31–35). VERIFIED for URL shape. UNVERIFIED against a live response.
- Parses any JSON on HTTP 200. It does not check `success` or normalize `final_amount`.
- Has no caller, so it does not affect booking today.

Mapping recommendation:

- Selected service `SP_INLAND_PARCEL` or `SP_INLAND_DOC` → request `product-code=SP`.
- Keep booking `article_type` unchanged.
- Show response `article_type` (`SP_INLAND_DOC` or `SP_INLAND_PARCEL`) as the API classification, not as a booking mutation.
- Send integer grams. Documented document limits are 1–500 g and parcel limits 1–35000 g (`article-validator.ts` lines 27–32). Those limits already match the task’s tariff tables for booking. Applying them to a quote is recommended, with the zero-dimension ambiguity in Section 13 left explicit.

## Section 8 — Business Parcel tariff analysis

NOT FOUND in code.

Documented call: `GET {base}/beextcustomer/v1/business-parcel-tariff/calculate` with `product-code`, `weight`, both pincodes, `length`, `width`, `height`, and `ins`.

Specification gap, VERIFIED as a documentation gap rather than a code bug:

- The sample response includes `cod_charges`.
- The documented query does not include a COD amount or COD flag.
- PostBus must not invent `cod`, `COD`, or `value_for_codr_cod` on this GET.
- The estimate UI should show `cod_charges` only when the API returns it, and label it as an India Post fee, separate from `orders.cod_amount`.

Request `product-code` should stay `BP` until India Post documents otherwise. Response `product_code=BUSINESS_PARCEL` is a response field.

`ins` is lowercase in the Business Parcel example and `INS` is uppercase in the Speed Post example. Preserve each documented casing. Do not send `POD` on Business Parcel; it is not in that query list.

## Section 9 — Recommended integration points

| Option | Verdict |
|---|---|
| A. On opening an order | Reject. Opening a list would fan out GETs and block the page on India Post downtime |
| B. When the merchant changes service | Accept as a refresh of an already requested quote, not as an automatic call on first render |
| C. Immediately before booking | Accept as an optional confirm step. Must not be inside `bookShipment` |
| D. Explicit Calculate action | Preferred for the first release |
| E. Bulk orchestration | Later phase only. The tariff APIs are single-article GETs |

Do not call either API from Shopify order sync (`modules/shopify/orders.ts`). Sync already writes `shipping_amount`. A tariff call there would multiply API load by every order update and could be mistaken for the customer’s shipping price.

First integration point: order details and the manual order form, server route only, after the order belongs to `ctx.organizationId`. The browser sends order id and service code. The server loads weight, dimensions, pincodes, and the connection.

## Section 10 — Bulk processing architecture

Existing bulk booking is a separate, guarded pipeline (`INDIA_POST_BULK_CONCURRENCY`, default off or concurrency 1 in `bulk-booking-safety.test.ts`). It books articles. It is not a tariff bulk API.

India Post bulk tariff: NOT FOUND and not documented. PostBus would loop the single GET.

Architecture for a later phase, not for the first release:

- Queue one job per organization and order set. Do not start 1,000 parallel GETs.
- Concurrency 2 per organization until India Post publishes a limit. The limit is UNKNOWN.
- Dedupe key: organization, service, source pin, destination pin, weight, dimensions, insurance, POD.
- Timeout: reuse 15 seconds (`INDIA_POST_TIMEOUT_MS.search`), which `getTariff` already uses.
- Retry: at most 2 tries on timeout or HTTP 429/503, with backoff. No retry on 400 or 401 after one re-login.
- Isolate failures per order. Do not fail the batch or change booking status.
- 10–50 orders can be on-demand. 100+ should be a job with progress. 500–1,000 should be refused or deferred until caching and a published rate limit exist.

## Section 11 — Multi-tenant security

VERIFIED controls to reuse:

- Connection row is unique per organization.
- Settings GET is filtered by `ctx.organizationId` and strips secrets (`integrations.ts` lines 625–645).
- Connection RLS is member-scoped.

Risks if a tariff route is added carelessly:

- Loading an order by id without `.eq("organization_id", ctx.organizationId)` would quote another tenant’s shipment. Current order reads do filter by organization (`modules/orders/service.ts` `getOrder`).
- A shared in-memory tariff cache keyed only by pincodes and weight would leak prices across merchants if contract rates ever differ. Cache keys must include `organization_id` even if rates turn out to be public.
- Returning the provider JSON unchanged could include unexpected account fields. Return a normalized DTO.
- Service-role tariff jobs must carry `organization_id` from the job row, not from client input.

No evidence was found that the current unused `getTariff` is reachable from a browser.

## Section 12 — Database design recommendation

Do not add a quote table in the first slice.

Store nothing, or store one latest estimate in `orders.metadata` / a nullable jsonb column only if the UI must survive a reload. Do not write `shipments.tariff_amount` until booking. Do not write `orders.shipping_amount`.

If history is required later, one `india_post_tariff_quotes` table is enough. Justified columns:

- `organization_id`, `order_id`, `service_code`
- request: source pin, destination pin, physical grams, length, width, height, insurance, POD
- response: `chargeable_weight`, `base_tariff`, `vas_charges`, `cod_charges` (nullable), `total_tax`, `final_amount`, `currency`, `article_type`
- `calculated_at`, `expires_at` (suggest 24 hours; not an India Post rule)
- `status` (`QUOTED` / `FAILED`)

Skip `provider_response_reference` until India Post returns an id. Raw response storage is optional and must be access-controlled like the connection row.

Contract discounts: OPEN QUESTION. Do not label `final_amount` as the contractual invoice.

## Section 13 — UI recommendations

Existing surfaces:

- Manual create: `app/dashboard/orders/new/page.tsx` (service, weight, dimensions, COD collection).
- Order details: `app/dashboard/orders/[id]/page.tsx` (weight copy already says India Post uses box weight for the tariff, around line 507; that refers to booking, not a live quote).
- Shipment details: `app/dashboard/shipments/[id]/page.tsx` shows booked `tariff_amount`.

Put the estimate on order details and the manual form summary, not on the shipment page. The shipment page should keep showing the booked tariff only.

Match the current card, `text-sm`, and `formatCurrency` patterns. Button: “Calculate shipping estimate”. Result block uses the proposed labels, with “Estimated” on the total. Errors stay in the card. The orders table must still render if the tariff API is down.

Do not add the button to Shopify sync or to the booking primary action in the first release.

## Section 14 — Performance and reliability

- Timeout: 15 seconds, already used by the unused method.
- Auth failure: one re-login through `token()`, then fail the quote.
- Retries: bounded, see Section 10. Never infinite.
- Duplicate clicks: client disable plus a server in-flight key per order and service.
- Stale quote: invalidate when weight, dimensions, pins, service, insurance, or POD change.
- Circuit breaker: not justified before production error rates exist.
- Logging: log organization id, order id, service, HTTP status, and duration. Do not log tokens.
- Failure effect: return an error DTO. Do not change `orders.status` or `shipments.status`.

India Post rate limits: UNKNOWN.

## Section 15 — Booking API compatibility

A quote implementation must not call `bookShipment`, `allocateBarcode`, enqueue a booking job, create a shipment, set fulfillment, generate a label, or change `cod_amount`.

Current `getTariff` does none of those. The risk is accidental reuse of `bookShipment`’s session helper or writing `calculated_tariff` into `tariff_amount` before an article exists.

Booking should keep sending physical weight and dimensions. It should not replace them with tariff `chargeable_weight`.

## Section 16 — Risks and breaking changes

| ID | Severity | Status | Evidence | Impact | Recommendation |
|---|---|---|---|---|---|
| T1 | P1 | VERIFIED | `getTariff` defaults weight to 100 and product to SP (`provider.ts` lines 156–157) and has no validation | A future caller could quote the wrong service and weight | Do not expose this method. Add a typed builder that requires every documented input |
| T2 | P1 | VERIFIED | No Business Parcel tariff client | BP bookings cannot be estimated by the existing method | New function, separate URL and query (`ins`, not `INS`/`POD`) |
| T3 | P1 | VERIFIED | `shipments.tariff_amount` is the booking result | Overwriting it with an estimate hides the booked price | Separate field or no persistence |
| T4 | P2 | VERIFIED | `orders.shipping_amount` is the Shopify buyer charge | Merchants may compare it with India Post’s price and confuse the two | Label both in the UI |
| T5 | P2 | VERIFIED | COD request parameter is undocumented while `cod_charges` is in the sample response | Inventing a parameter can cause HTTP 400 or a wrong fee | Display response only |
| T6 | P2 | PARTIAL | Token refresh grant NOT FOUND; login is repeated | Tariff bursts can stampede `/access/login` | Reuse `ensurePersistedIndiaPostSession` and the per-connection lock |
| T7 | P2 | OPEN | Contract price vs public tariff | Quote may not match the invoice | Show “estimate” until India Post confirms |
| T8 | P3 | VERIFIED | `getTariff` ignores `success: false` on HTTP 200 | A failed body could look like a quote | Require `success` and numeric `final_amount` |

No current booking path calls `getTariff`, so leaving it unused is non-breaking.

## Section 17 — Missing requirements and ambiguities

- Does Speed Post `product-code=SP` return both document and parcel classifications from weight and dimensions? OPEN. PostBus booking already forces parcel vs document itself.
- May tariff dimensions be 0 while booking requires parcel dimensions? The task states both. PostBus booking rejects parcel dimensions outside 14–150 / 9–150 / 1–150 (`article-validator.ts` lines 27–32). Recommendation: quote only when booking validation would accept the parcel. Do not silently send zeros for parcels.
- Business Parcel `ins` versus Speed Post `INS` casing: follow each example. OPEN if the server is case-insensitive.
- `cod_charges` without a request field: OPEN.
- Contract discount: OPEN.
- Official rate limit: UNKNOWN.
- Volumetric divisor: local code uses `/5` grams. Confirm it matches `chargeable_weight` before showing both as equal.

## Section 18 — Implementation roadmap (not started)

### Phase 1 — Client and auth

Objective: typed Speed Post and Business Parcel GET builders on `IndiaPostProvider`, using `token()` / persisted session.

Files: `modules/india-post/provider.ts`, `endpoints.ts`, new `tariff.ts`, tests beside `provider.session.test.ts`.

Risk: reusing `getTariff` unchanged. Rollback: delete the new module; booking does not call it.

Acceptance: mocked HTTP only; no live CEPT calls.

### Phase 2 — Quote service

Objective: validate inputs, map service → `product-code`, normalize the response DTO.

Depends on Phase 1. Must not write shipment or order status.

### Phase 3 — Order mapping

Objective: resolve sender pin from the connection, receiver pin, parcel weight, and dimensions from the existing booking inputs.

Acceptance: missing pin, weight, or parcel dimensions returns a validation error and does not call the network.

### Phase 4 — Single-order route

Objective: authenticated route, organization scoped, explicit calculate.

Rollback: remove the route.

### Phase 5 — UI

Objective: estimate card on manual create and order details.

Acceptance: orders list still loads when the route returns 503.

### Phase 6 — Bulk

Objective: queued, low-concurrency orchestration. Not in the first production slice.

### Phase 7 — Security and regression

Cross-tenant order id, secret redaction, booking/label/tracking/COD/Shopify fulfillment tests unchanged.

### Phase 8 — Staging

UAT host only, with merchant approval. Production credentials stay unused.

### Phase 9 — Production

Feature flag per organization. Default off.

## Section 19 — Testing strategy

Unit: request builders for SP and BP; integer weight; pincode; dimension limits; response normalizer; HTTP 200 with `success: false`; missing fields.

Integration (mocked fetch): token reuse, expired token re-login, 401, timeout, Business Parcel URL distinct from Speed Post.

Workflow: manual and Shopify orders, both services, COD collection unchanged, prepaid, insurance present and absent.

Regression: `bookShipment` payload, barcode allocation, label, tracking, `cod_amount`, Shopify fulfillment. Assert they are not invoked by the quote service.

Security: another organization’s order id returns not found; response fixture contains no `access_token`; cache key includes organization id.

No production or UAT calls in CI.

## Section 20 — Final architecture recommendation

Add a server-side quote service beside the existing provider. Reuse login, encryption, environment URL, timeouts, and organization scoping. Do not reuse the current `getTariff` body without replacing it. Keep quotes out of `tariff_amount` and `shipping_amount`. Trigger only from an explicit calculate action. Defer bulk. Treat every figure as an estimate until India Post confirms contract pricing and COD fee inputs.

## Findings classification

| ID | Class |
|---|---|
| Speed Post method present but unused and incomplete | VERIFIED |
| Business Parcel tariff client | NOT FOUND |
| Booking tariff stored on the shipment | VERIFIED |
| Auth reuse is safe if the persisted session helper is used | VERIFIED |
| Refresh-token grant | NOT FOUND |
| Contract-specific rates | UNVERIFIED |
| COD tariff request parameter | UNVERIFIED / do not invent |
| Server Actions | NOT FOUND |
| Live tariff behavior | NOT APPLICABLE to this audit (no live calls) |

## Final audit questions

**Q1.** Does PostBus already calculate tariff? A Speed Post GET exists and is unused. Booking stores India Post’s `calculated_tariff` after booking. There is no Business Parcel quote and no pre-booking product.

**Q2.** Can authentication be reused? Yes. Use `IndiaPostProvider.token` through the persisted session helper. Do not add a second login.

**Q3.** Are weight and dimensions available? Often, on the shipment and workspace defaults. They are not guaranteed on every Shopify order. Missing values must block the quote. Sender pincode comes from the India Post connection, not the order.

**Q4.** Where should it trigger? A server route behind the order details page and the manual order form.

**Q5.** Automatic or on request? On request. Not during Shopify sync.

**Q6.** Bulk? Later, as a queued loop over the single-article GETs, concurrency 2 per organization, failures isolated.

**Q7.** Store quotes? Not in the first release. Never in `shipments.tariff_amount` or `orders.shipping_amount`.

**Q8.** Cache? Optional, keyed by organization plus the full request, short TTL. Not required for the first button.

**Q9.** Booking impact? None if the quote path does not call booking, barcodes, labels, or status updates. The unused method currently has no booking side effects.

**Q10.** Tenant risks? Existing connection isolation is sound. A new route or cache without `organization_id` would be a P0. Design must include that filter.

**Q11.** Contract rates? OPEN. The specification does not establish merchant-specific discounts.

**Q12.** COD? Keep collection amount on `cod_amount`. Show `cod_charges` only if returned. Do not invent a COD query parameter.

**Q13.** API down? The calculate card shows an error. Order status, booking, and the orders list stay unchanged.

**Q14.** Minimum-risk approach? Explicit single-order quote, mocked tests, feature flag, no schema change, no booking changes.

**Q15.** Is the architecture ready? The auth, tenant, weight, dimension, and service mapping pieces are ready to build on. The current `getTariff` method is not an acceptable implementation. Implementation has not started.

Stop. No implementation until an explicit approval.
