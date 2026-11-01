# PostBus India Post Tariff Quote Implementation

Date: 16 October 2026. Repository: `D:\POST BUS APP`.

## Current UI revision — automatic inline tariff

The user subsequently requested automatic calculation using the existing order fields and styling. This supersedes the original explicit-button/card UX described in the historical implementation sections below.

- The separate calculator card, duplicate weight/dimension/service controls, insurance/POD controls, and Calculate button have been removed from the UI. The backend optional-service contract remains available.
- Estimated shipping appears as an inline row inside the existing manual-order Shipment section and the existing order-details parcel area. The breakdown is expandable.
- Valid existing fields trigger an automatic quote after an 800 ms editing pause, including initial valid field hydration. Lookups are serialized, with at least 6.5 seconds between starts to respect the existing server rate limit. No polling or automatic failure retry is added.
- Order details use the existing unsaved box-weight controls plus persisted/configured service and dimensions. No parcel values are saved by the tariff UI. Invalid/missing values prevent provider calls.
- Editing any relevant input immediately hides the prior amount. Generation tracking prevents stale results after editing and reverting to the same values. Workspace changes also invalidate results.
- Sender selection is shown only when multiple configured offices require disambiguation; a single configured office is used directly.
- The feature was enabled for local development only in ignored `.env.development.local`, at the user's request. The deployment default remains OFF. No production environment or deployment was changed.
- Verification for this revision: TypeScript passed; changed UI lint passed with the same pre-existing manual-order hook warning. The isolated browser harness passed automatic calculation on both surfaces, existing-field reuse, disabled flag, debounce, serialized requests, edit/revert stale suppression, workspace changes, provider errors, and invalid-input blocking. All APIs were mocked; no live provider calls occurred.

The sections below record the original implementation and its baseline test evidence; the revision above describes the current UI behavior.

## Executive summary

**VERIFIED (local, mocked):** Added explicit Speed Post and Business Parcel estimates to manual order creation and existing order details. The feature defaults OFF. Estimates are informational component state; they do not persist to orders or shipments. No database migration, production configuration change, deployment, staging validation, or live India Post request was performed.

**PARTIALLY VERIFIED:** Local implementation and regression checks pass, but production readiness is not established. Authorized UAT, deployed RLS/token-persistence verification, and deployment-wide concurrency evaluation remain outstanding.

## Architecture verified

- **VERIFIED:** This repository uses Next.js 16.3.8, React 19, Supabase, `TenantContext`, the v1 dispatcher, React Query, and Zod. It is the project matching the audit, unlike the earlier InsForge workspace.
- **VERIFIED:** Read `POSTBUS_INDIA_POST_TARIFF_API_AUDIT.md`, current provider/session/order code, local Next.js route-handler documentation, and the tariff portions of `New_Customer_Integrations_approach_document_31052026 -new.docx`.
- **VERIFIED:** The formerly unused tariff method supplied an arbitrary 100 g default and supported only Speed Post. It now accepts validated typed input and selects the documented service endpoint.
- **VERIFIED:** The general persisted-session helper now takes a booking lock. Tariff authentication instead reuses the provider and existing process-session lock without calling the booking-lock helper.
- **VERIFIED:** Existing `getOrder()` triggers Shopify image enrichment. Quotes use their own read-only, organization-filtered projection instead.
- **VERIFIED:** Existing parcel-default application supplies fallback sizes/weight. Quotes do not call it: only persisted values and explicitly configured defaults are used.
- **VERIFIED:** Pre-existing local edits to `app/dashboard/shipments/[id]/page.tsx`, `lib/dashboard/india-post-routing.ts`, and its test were preserved. Existing untracked artifacts were not removed or overwritten.

## Files created

- `modules/india-post/tariff-contract.ts`: strict input contracts, request construction, response validation and normalization.
- `modules/india-post/tariff.ts`: sender/order resolution, authentication orchestration, safe failures, quote execution.
- `modules/india-post/tariff.test.ts`: 47 mocked contract, tenant, provider, and session tests.
- `lib/api/v1/tariff.ts`: capabilities, manual preview, and existing-order handlers.
- `lib/api/v1/tariff.test.ts`: 11 route, permission, feature flag, subscription mapping, and throttling tests.
- `components/orders/tariff-estimate-card.tsx`: shared estimate controls and result display.
- `scripts/test-tariff-ui.mjs`: isolated Chromium workflow test with every API stubbed.
- `POSTBUS_TARIFF_API_IMPLEMENTATION_REPORT.md`: this report.

## Files modified

- `modules/india-post/provider.ts`: replace unused tariff request body; keep booking methods unchanged.
- `lib/api/v1/handle.ts`: register tariff handlers after tenant/subscription checks.
- `lib/api/v1-permissions.ts`: explicit tariff permission mapping.
- `modules/billing/entitlements.ts`: existing India Post entitlement for quote POSTs.
- `lib/env.ts`: default-off boolean flag.
- `.env.example`: document disabled flag; actual environment files were not edited.
- `app/dashboard/orders/new/page.tsx`: attach the card to current unsaved inputs.
- `app/dashboard/orders/[id]/page.tsx`: attach the card and invalidate it when order or draft weight state changes.

## Provider implementation and response contract

**VERIFIED by mocks:** Speed Post uses the existing environment resolver with `/v1/speed-post/tariffs`, `product-code=SP`, physical integer grams, pincodes, dimensions, optional uppercase `INS`, and selected `POD=YES`.

**VERIFIED by mocks:** Business Parcel uses `/v1/business-parcel-tariff/calculate`, `product-code=BP`, and optional lowercase `ins`. No POD or COD request parameters are introduced.

**VERIFIED:** All dimensions are required for this first release. Official table limits take precedence over contradictory examples. Service classification is explicit. Speed Post parcel estimates at or below 500 g are blocked pending UAT; document quotes within document limits remain supported. Existing booking validation and behavior are untouched.

**VERIFIED:** Runtime response validation requires `success:true`, INR, finite nonnegative `base_tariff` and `final_amount`. Invalid present optional monetary values are rejected; absent optional charges become null. VAS accepts either a number or a map of named amounts, matching the document's different SP/BP examples. Provider `final_amount` is used unchanged; no breakdown summation is performed. Unexpected extra provider fields are not exposed.

**VERIFIED:** Output contains service, article classification, server-resolved source/destination, physical/chargeable weights, breakdown, estimated total, INR, server calculation time, and `isEstimate:true`. Charges are not copied into COD, shipping, booking tariff, or customer totals.

## Authentication and security controls

**VERIFIED by mocks and code inspection:** The server resolves the tenant from the existing authenticated context. Manual previews require `orders.write`; order estimates and capabilities require `orders.read`. Quote POSTs retain the India Post subscription entitlement. Disabled handlers do not load credentials or contact the provider.

**VERIFIED:** Existing-order ownership is checked using the request Supabase client before privileged connection access. The connection is fetched using the trusted organization ID. Privileged access is limited to connection reads and normal encrypted token persistence. Every session write filters both organization and connection ID and checks the returned row/error.

**VERIFIED:** Client-supplied organization IDs, credentials, environments, URLs, and source pincodes are rejected by strict schemas. Sender selection is restricted to valid configured pickup/drop-off offices. Different pincodes require an explicit choice; a single unique configured pincode is unambiguous.

**VERIFIED by mocks:** Session preparation reloads the connection inside `withProcessSessionLock`, reuses valid encrypted tokens with the provider's 60-second skew, and performs normal login when expired. On HTTP 401 it retries authentication and the tariff lookup at most once. A token already refreshed by another request is reused. Persistence failure prevents the lookup.

**VERIFIED:** The tariff path never acquires the booking lock, reserves a barcode, creates jobs/shipments/orders, enriches Shopify data, or calls label/tracking/billing operations. Successful mock executions use database objects with no booking RPC or other mutation interfaces.

**VERIFIED:** Logs include trusted organization/order identifiers, service, safe category/status, and timing. Normalized errors exclude raw provider/authentication/database errors. No credentials enter browser state. Successful capability/quote responses are private/no-store, and provider lookups use no-store.

**PARTIALLY VERIFIED:** Tenant filters, privilege boundaries, and error handling are covered by local tests. Actual deployed RLS and service-role token writes were not exercised against a database.

## Quote service and UI

**VERIFIED:** Manual previews require no order ID and use current unsaved parcel/form values. Partial item-weight totals are not silently used when a line item has no weight.

**VERIFIED:** Existing orders use a dedicated projection of the address, parcel override, line weights, and shipment measurements. Temporary card inputs override quote values only. The destination remains server-controlled. Explicit configured defaults are used only where persisted measurements are absent; arbitrary fallback dimensions are not introduced.

**VERIFIED by isolated browser test:** Cards are hidden when disabled or capabilities fail. Lookups occur only after an explicit click; loading disables the button, mutation retries are disabled, and failures stay inside the card. Editing inputs invalidates the result, including edit-and-revert while a request is in flight. Workspace/order changes remount the quote state, preventing stale results from reappearing.

**VERIFIED:** The card labels the provider total as estimated, shows physical and chargeable weights, displays available VAS/tax/COD service charges separately, and explains that breakdown entries may overlap and contracted discounts are unverified.

**PARTIALLY VERIFIED:** The browser test bundles the real component with existing React Query/UI dependencies and mocked APIs. It is not a full authenticated production-page visual review or a real database integration test.

## API reference

| Method/path | Inputs | Result |
|---|---|---|
| `GET /api/v1/india-post/tariff-capabilities` | Optional `orderId` for tenant-checked existing-order defaults | Enabled flag, organization ID, safe sender choices, optional defaults |
| `POST /api/v1/india-post/tariff-quotes` | Explicit service, destination pincode, physical weight, dimensions, optional sender office/insurance/POD | Normalized estimate |
| `POST /api/v1/orders/:id/tariff-quote` | Optional service and quote-only parcel overrides, sender office, insurance/POD | Tenant-owned order estimate |

Service values are `SP_INLAND_DOC`, `SP_INLAND_PARCEL`, and `BUSINESS_PARCEL`; the provider query maps them to SP/BP. Sender office values are `pickup` and `dropoff`. All responses use the existing API envelope. Safe tariff categories are carried in error details using existing application HTTP/error conventions.

## Tests and results

All provider HTTP responses in new automated tests are mocked. The browser harness blocks non-local network requests and permits only mocked capabilities/session/quote APIs.

| Check | Classification | Result |
|---|---|---|
| `npm run typecheck` after final implementation | VERIFIED | Passed |
| Final targeted Vitest: tariff contract/service, tariff routes, existing permission tests | VERIFIED | 3 files passed; 61 tests passed |
| Earlier targeted session/provider compatibility run | VERIFIED | 5 files passed; 66 tests passed before three additional tariff cases were added |
| Broader regression: `modules/india-post modules/orders modules/labels modules/shopify modules/shipments modules/billing lib/api/v1-permissions.test.ts lib/api/v1/tariff.test.ts` | VERIFIED | 106 files passed; 958 passed, 1 existing skip; run before three additional tariff tests |
| Isolated Chromium workflow script | VERIFIED | Passed; manual/existing, feature-off, temporary values, errors, duplicate suppression, stale response, workspace change, light-parcel block |
| ESLint on all new/modified tariff files | VERIFIED | Exit 0; no errors; one pre-existing `catalogItems` hook warning on manual-order page |
| ESLint on application source directories | BLOCKED by existing lint debt | 40 errors, 54 warnings; errors occur outside tariff changes |
| `git diff --check` | VERIFIED | Passed |
| Staging / live UAT | UNVERIFIED | Not run, requires explicit authorization |
| Production build / deployment | NOT APPLICABLE to this local verification | Not run; no production environment changes |

Initial unrestricted `npm run lint` was interrupted after it continued traversing the repository's unrelated worktrees/generated content. The completed source-directory lint command was:

```text
npx eslint app components lib modules types workers scripts proxy.ts proxy.test.ts instrumentation.ts instrumentation-client.ts next.config.ts
```

Representative pre-existing failures: synchronous effect state updates in login, India Post settings, Wati settings, and tracking components; `prefer-const` violations in existing contract/order tests and Razorpay settings. These were not changed as part of tariff work.

To repeat the browser test, use Node with Playwright available, or set `POSTBUS_PLAYWRIGHT_MODULE` to an installed Playwright `index.mjs`, then run:

```text
node scripts/test-tariff-ui.mjs
```

The test used the desktop's bundled Playwright. No runtime/development package dependencies or lockfiles were added or changed.

## Known limitations and unverified provider behavior

- **UNVERIFIED:** Live tariff result classification, exactly-500-g interpretation, insurance/POD semantics, COD fee semantics, actual contract discounts, and provider rate limits.
- **VERIFIED limitation:** Throttling is 10 attempts per organization per minute and one in-flight quote per organization **per process**, reusing existing infrastructure. Process-local session locks do not serialize separate replicas. No new Redis or database infrastructure was introduced.
- **UNVERIFIED:** Cross-replica auth refresh behavior and token invalidation interactions with production booking/tracking. Evaluate during authorized UAT before enabling beyond a controlled instance.
- **VERIFIED limitation:** Quote state is temporary; navigation/reload clears estimates. No quote cache/history, bulk lookup, background job, automatic calculation, or booking prerequisite exists.
- **PARTIALLY VERIFIED:** Component behavior is covered in an isolated browser; the full application was not started with production credentials and no production build was executed.

## Deployment requirements, rollback, and readiness

**VERIFIED:** Flag defaults OFF when absent or not `true`. `.env.example` documents `INDIA_POST_TARIFF_QUOTES_ENABLED=false`. Normal India Post credentials, encryption, environment resolver, and Supabase service role remain server-only prerequisites. No new secret or migration is required.

Before any activation, obtain explicit authorization for isolated staging/UAT. Verify staging identity and test organization, session RLS/persistence for each intended role, both provider endpoints, exact service classification, no order/shipment side effects, application-page accessibility/visual presentation, and deployment-wide throttling/session behavior. Do not use real shipment booking as part of tariff verification.

Rollback: set the server flag false and restart/redeploy through the separately approved operational process. This hides controls and rejects new quote requests; existing in-flight requests may finish. No quote data or schema rollback is necessary.

**Final status: PARTIALLY VERIFIED — local implementation complete and mocked checks passing; production activation blocked pending authorized UAT and resolution/acceptance of deployment limitations. No staging validation, production configuration, or deployment was performed.**
