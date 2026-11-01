# PostBus AI AutoPack — Merchant Custom Size Intelligence

Read-only architecture audit + design proposal. Date: 2026-11-01. Branch inspected: `fix/auth-session-stability` (working tree has large uncommitted changes, see §6).

Nothing was changed in code, schema, staging or production for this audit.

---

## 1. What exists today

### 1.1 Where dimensions live

| Place | What it holds | File |
|---|---|---|
| `shipments.length_cm / width_cm / height_cm / weight_grams` | The dimensions India Post books against | `supabase/migrations/20260919090100_commerce_shipping.sql` |
| `shipments.metadata.parcelDimensions` | `{ source, packageId, packageName, unit, L/W/H, syncedAt }` | `modules/shopify/dimensions.ts` (`parcelDimensionsMetadata`) |
| `shipment_packages` | Per-package rows (unused by sizing logic) | same migration |
| `user_shipment_presets` | Saved pack sizes: name, weight, L/W/H, service_code, `last_used_at` | `supabase/migrations/20261008170000_user_shipment_presets.sql`, `modules/shipments/presets.ts` |
| `india_post_connections.default_*` | Workspace default box + weight | `supabase/migrations/20261004180000_india_post_parcel_defaults.sql` |
| Hard-coded quick sizes (Small/Medium/Apparel/Large) | UI only | `components/orders/shipment-pack-presets.tsx:20` |

### 1.2 Dimension sources (current enum)

`DimensionSource = "shopify" | "postbus_package" | "postbus_default" | "postbus"` (+ legacy `"manual"` read-side), `modules/shopify/dimensions.ts:10`.

- `shopify`: one unit (qty 1) whose variant/product metafields give a box.
- `postbus_package`: one unmeasured unit, and the org has **exactly one** preset.
- `postbus_default`: one unmeasured unit, no presets, workspace default set.
- `postbus`: anything the merchant typed or picked in PostBus (`modules/shipments/service.ts:788`, `:921`).

Two or more units are never auto-sized (`resolveShipmentDimensions`, `dimensions.ts:200`). That's a sound safety rule and AutoPack should keep it for anything that isn't backed by history.

### 1.3 Manual override protection (already present)

`manualDimensionLock(source)` returns true for `postbus`/`manual` (`dimensions.ts:285`), and the Shopify re-sync hydrate respects it (`modules/shopify/orders.ts:1307`). Locked shipment statuses (`VALIDATING`, `QUEUED`, `BOOKING`, …) and locked order statuses (`BOOKED`, `SHIPPED`, …) are skipped (`orders.ts:730`). **Requirement 4 is mostly satisfied already.** AutoPack has to plug into this lock and must not bypass it.

### 1.4 India Post validation

- Authoritative per-service limits: `modules/india-post/article-validator.ts:25-36` (parcel 14–150 × 9–150 × 1–150 cm / 35 kg; document 42×29×2 / 500 g; a 5 kg service).
- **The same limits are duplicated** in `parcel-defaults.ts` constants, the `updateShipmentDimensionsSchema` zod literals (`service.ts:653+`), the preset DB `CHECK`s, and `bulk-eligibility.ts`. Today they agree. They will drift.

### 1.5 Booking safety

CAS claim + `booked_at`/barcode authority + "unknown means never re-POST" (`modules/india-post/booking-idempotency.ts`). Booking is only enqueued by `createShipmentsForOrders` with `enqueueBooking`, and auto-processing creates shipments with `enqueueBooking: false` (`orders.ts:2776`). AutoPack doesn't need to touch any of this. It should only write dimensions on unbooked DRAFT rows.

### 1.6 Shopify line items

`order_line_items` stores `title, sku, variant (title text), quantity, unfulfilled_quantity, source_line_item_id, weight_grams, product_id (PostBus products FK)`. **Shopify `variant_id` / `product_id` are available on the remote payload (`orders.ts:237-238`) but are not persisted** (`shopifyLineItemRows`, `orders.ts:1068`). Shop identity is one `shopify_connections` row per org.

---

## 2. Gaps against the requirement

| # | Requirement | Gap | Severity |
|---|---|---|---|
| G1 | Exact product + quantity matching | No stable variant key stored on line items. SKU/title are not reliable (blank SKUs, renamed titles). | **Blocker** |
| G2 | Custom size learning | No history table. Manual edits only write an `audit_logs` row (`shipment.dimensions_created`), with no composition attached. | **Blocker** |
| G3 | Distinguish preset vs custom | Selecting a saved preset in the UI posts plain L/W/H. The server stamps `source: "postbus"` and drops the preset ID. Today a preset pick can't be told apart from a typed custom size. | High |
| G4 | Entered / confirmed / verified | No evidence-level concept anywhere. | High |
| G5 | Decision output A/B/C | `resolveShipmentDimensions` returns a box or `null`. There's no explicit `MANUAL_REVIEW_REQUIRED` with a reason, and no evidence reference. | Medium |
| G6 | One validation rule set | Limits are duplicated in 5 places (§1.4). | Medium |
| G7 | Merchant opt-in for auto-apply | `automation` settings have no packaging flag. | Medium |
| G8 | Preset scoping | Presets are **per-user** (`user_id` + RLS `user_id = auth.uid()`), but `loadOrganizationPackages` queries by org only. Under a user session it returns only that user's presets. Under a service/webhook client it returns every member's. The `packages.length === 1` auto-pick (`dimensions.ts:211`) therefore behaves differently depending on who or what triggered the sync. | **Existing bug**, worth fixing before AutoPack builds on it |
| G9 | Race on hydrate write | The Shopify hydrate `UPDATE` (`orders.ts:1319`) filters by `id` + `organization_id` only. Status was checked earlier in a separate read, so a shipment that moves to `QUEUED` in between can still get new dims. | Low (existing). AutoPack writes must use a guarded update. |

---

## 3. Proposed design

### 3.1 Principle: deterministic first, AI never invents numbers

Exact-composition reuse is a lookup, not an inference. The decision engine is pure deterministic code. Any LLM use is limited to explaining a recommendation or ranking *existing* evidence rows (e.g. "you used 30×25×15 for this bundle 6 times"). It may never emit a dimension that isn't copied from an evidence row, a preset, Shopify measurements, or the workspace default. Every `CUSTOM_DIMENSIONS` decision carries an `evidenceId`.

### 3.2 Schema (all additive, flag-gated)

**a) `order_line_items` (additive columns)**
```
shopify_variant_id text null
shopify_product_id text null
```
Populated by `shopifyLineItemRows` from the next sync onward. No historical backfill on production. Old rows simply never match exactly.

**b) `packaging_history` (new, org-scoped, RLS via `is_org_member`)**
```
id uuid pk
organization_id uuid not null
shop_domain text null                  -- Shopify store identity
order_id uuid null, shipment_id uuid null
composition_key text not null          -- sha256 of sorted "variantId:qty" pairs
composition jsonb not null             -- [{variantId, productId, sku, title, qty}]
unit_count int not null
length_cm, width_cm, height_cm numeric not null
weight_grams int null
service_code text not null
package_source text not null           -- 'preset' | 'custom' | 'shopify' | 'default' | 'history'
preset_id uuid null                    -- set when package_source = 'preset'
evidence_level text not null           -- 'entered' | 'confirmed' | 'verified'
entered_by uuid, entered_at timestamptz
confirmed_at timestamptz null          -- shipment booked with exactly these dims
verified_by uuid null, verified_at timestamptz null
superseded_at timestamptz null         -- merchant corrected it later
created_at timestamptz default now()
index (organization_id, composition_key, evidence_level) where superseded_at is null
```
`composition_key` is only computed when **every** line has a `shopify_variant_id`. Otherwise no key and no history match.

**c) Evidence levels (strict meanings)**
- `entered`: the merchant typed L/W/H on a shipment. No claim it's physically correct.
- `confirmed`: that shipment was then **booked with the same dims** (set from booking-apply when `booked_at` is written). That shows the merchant committed to the size. It does *not* show the box was measured.
- `verified`: the merchant explicitly marked it "Measured / use for this bundle" (a checkbox on the dimension editor or an action on the history list). This is the only level that permits auto-apply.

A later manual change for the same composition sets `superseded_at` on older rows, so a corrected size wins.

**d) `automation` settings**: `auto_package_selection boolean default false`.

**e) Shipment metadata**: extend `parcelDimensions.source` with `postbus_preset` (with `packageId`), `postbus_custom` and `autopack_history` (with `evidenceId`). Keep reading the legacy `postbus`/`manual`. `manualDimensionLock` must treat `postbus_preset` and `postbus_custom` as locked too.

### 3.3 Decision engine (`modules/autopack/decide.ts`, pure)

```ts
type PackageDecision =
  | { kind: "SAVED_PACKAGE"; presetId: string; box: CmBox; reason: string }
  | { kind: "CUSTOM_DIMENSIONS"; box: CmBox; evidence: { type: "history" | "shopify" | "default"; id?: string }; autoApplicable: boolean; reason: string }
  | { kind: "MANUAL_REVIEW_REQUIRED"; reason: ReviewReason; suggestions: Suggestion[] };
```

Precedence (first match wins):
1. Shipment has a manual-locked source → **no decision, never touch.**
2. Shipment not in an unbooked DRAFT state → no decision.
3. Exact `composition_key` match with a non-superseded **verified** row → `CUSTOM_DIMENSIONS` (or `SAVED_PACKAGE` if the row was a preset that still exists with identical dims), `autoApplicable = true`.
4. Exact match, **confirmed** only → recommendation, `autoApplicable = false`.
5. Existing rules unchanged: single measured unit (`shopify`) → single preset → workspace default.
6. Otherwise → `MANUAL_REVIEW_REQUIRED` (`NO_HISTORY`, `MISSING_VARIANT_IDS`, `MULTI_UNIT_NO_EVIDENCE`, `CONFLICTING_HISTORY`, `INVALID_FOR_SERVICE`).

Rules:
- Different quantities produce a different key, so there's no match. Never scale a box by quantity.
- If two verified rows with different dims tie for the same key (no supersede), the result is `CONFLICTING_HISTORY` and goes to review.
- Every candidate passes through the shared India Post validator for the shipment's `service_code` before it's returned. A failing one becomes `INVALID_FOR_SERVICE`.

### 3.4 Apply path

- Auto-apply only if `auto_package_selection = true`, `autoApplicable`, and validation passes.
- Write with a guarded update: `.eq("id").eq("organization_id").is("booked_at", null).in("status", ["DRAFT"])`, then re-read the source and abort if it's manual-locked. Never enqueue booking from AutoPack. The existing booking pipeline and CAS stay the only path to India Post.
- Each apply or recommendation writes an `audit_logs` row with the decision and `evidenceId`.

### 3.5 Learning capture hooks

- `updateShipmentDimensions` and create-with-dims (`modules/shipments/service.ts` ~L700-960): accept an optional `presetId` and `measured` flag from the UI, set the source to `postbus_preset` or `postbus_custom`, and insert a `packaging_history` row (`entered`, or `verified` when `measured`).
- `components/orders/shipment-pack-presets.tsx` and `order-dimension-badge.tsx`: send `presetId` on preset picks (fixes G3) and add the "Measured" checkbox.
- Booking success (`modules/india-post/booking-apply.ts`): promote the matching `entered` row to `confirmed` if the dims are unchanged.
- History capture only applies to shipments whose order has full variant IDs.

### 3.6 One validator (fixes G6)

Export `validateParcelBox(serviceCode, box, weight)` from `article-validator.ts`. Use it in presets, the dimension zod refinement, bulk eligibility and AutoPack. Keep the DB CHECKs as a backstop.

---

## 4. Test plan (Vitest unit + existing PGlite `.pg.test.ts` pattern)

| Case | Expectation |
|---|---|
| Existing preset package | Preset pick stores `postbus_preset` + `packageId`. History row has `package_source='preset'`. |
| Manual custom size | `postbus_custom` stored as `entered`. Manual-locked. |
| Historical custom size reuse | Verified row + same variant/qty composition → `CUSTOM_DIMENSIONS`, auto-applied only when the flag is on. |
| Exact product + quantity match | Key is order-independent across line ordering, and stable across title/SKU changes. |
| Different quantities | 1× vs 2× same variant → no match → `MANUAL_REVIEW_REQUIRED` (or existing single-unit rules). |
| Multiple products | A+B matches only A+B with the same quantities. A or A+B+C doesn't match. |
| Manual override preservation | Shipment already `postbus_*` → re-sync and AutoPack leave it untouched. Race test: status flips to `QUEUED` between read and write → no write. |
| AI recommendation rejection | Merchant rejects → shipment unchanged, rejection logged, the same evidence isn't auto-applied again for that shipment. |
| Missing dimensions / variant IDs | Line without `shopify_variant_id` → `MISSING_VARIANT_IDS`. Partial Shopify metafields → no box. |
| Confirmed-only history | Recommended, never auto-applied. |
| Conflicting verified rows | `CONFLICTING_HISTORY` → review. |
| India Post validation | History box valid for parcel but used on a document service → `INVALID_FOR_SERVICE`. Same validator result for preset and custom. |
| No duplicate booking | AutoPack never enqueues. Apply on `BOOKING`/`RECOVERY_REQUIRED`/booked rows is a no-op. Existing `booking-safety.pg.test.ts` still green. |
| Preset scoping (G8) | Same order sized identically under user-session and service clients. |

---

## 5. Release safety

- Migrations are additive only: new nullable columns, a new table, a new flag defaulting to `false`. No backfill and no update of any existing `shipments` row.
- Apply to **staging** (local Supabase via `.env.staging.local`) only. Don't run migrations or mutations against `.env.local`, which is production.
- The feature flag stays off for all orgs until a single-org canary, following the pattern already used for tracking P0.
- AutoPack only writes to unbooked DRAFT shipments created after the flag is on. Existing production shipments are never re-sized.
- No deploy step is part of this work.

## 6. Pre-implementation blockers / decisions

1. **Dirty working tree.** `modules/shipments/service.ts`, `modules/shopify/orders.ts`, `components/orders/*dimension*`/`*presets*` and many route files are modified or deleted but not committed on `fix/auth-session-stability`. Building AutoPack on top would tangle it with unrelated unreleased work. Recommended: commit or park the current changes, then branch `feat/autopack-custom-sizes` from `main`.
2. **Preset scope (G8). DECIDED 2026-11-01: org-wide.** Every member of a workspace sees and uses the same saved packages, and sync sizes an order the same way whatever triggered it. Migration plan (additive and reversible):
   - Keep `user_id` as the creator (rename it in the API to `createdBy`). Don't drop the column.
   - RLS: select/insert/update/delete becomes `is_org_member(organization_id)`. Insert still sets `user_id = auth.uid()`.
   - Uniqueness: two members of the same org may already have presets with the same name, so a new `unique (organization_id, name)` could fail on production. Before writing the migration, run a read-only count of `(organization_id, lower(name))` duplicates on staging and production. If any exist, keep the old per-user unique and enforce org-level name uniqueness only for new rows in the app layer.
   - The `SHIPMENT_PRESET_MAX = 12` cap becomes per org. Existing orgs above 12 keep what they have but can't add more.
   - `listShipmentPresets` and `loadOrganizationPackages` both filter by `organization_id` only.
   - The `packages.length === 1` auto-pick now counts org presets. For orgs that had one preset per user, that may change today's auto-size result from "one preset" to "several, needs a choice". Call this out in release notes.
3. **Meaning of "verified".** The proposal requires an explicit merchant "Measured" action. An alternative is auto-verifying after N identical confirmed bookings, but that infers physical correctness from repetition, which the requirement warns against.

---

## 7. Implementation status (2026-11-01, uncommitted on `fix/auth-session-stability`)

Built on top of the current working tree, as you chose. Nothing is committed, applied, deployed or run against staging or production.

| Area | Files |
|---|---|
| Migration (additive, re-runnable) | `supabase/migrations/20261101130000_autopack_custom_sizes.sql` |
| Composition key, decision engine, history, service | `modules/autopack/{composition,decide,history,service}.ts` |
| API (`autopack` root, `orders.read` / `orders.write`) | `lib/api/v1/autopack.ts`, `dispatch.ts`, `v1-permissions.ts` |
| Merchant saves: source labels, preset id, Measured, accepted suggestion, India Post check before writing | `modules/shipments/service.ts` |
| Workspace-wide pack sizes | `modules/shipments/presets.ts` |
| Shopify sync: variant ids, verified-history auto-apply with write-time guards and audit log | `modules/shopify/orders.ts` |
| Booking confirms a matching entered box | `modules/india-post/booking-run.ts` |
| Shared validator `parcelBoxIssue` | `modules/india-post/article-validator.ts` |
| Opt-in flag `autoPackageSelection` (Shopify plan feature, default off) | `modules/automation/service.ts`, `types/api.ts`, `modules/billing/entitlements.ts`, automation page |
| UI: AutoPack suggestion (Use this / Not right), "I measured this box", preset id sent on pick | `components/orders/autopack-suggestion.tsx`, `order-dimension-badge.tsx`, `shipment-pack-presets.tsx` |

Decisions taken while building:
- **Name uniqueness.** The per-member unique constraint is kept. Workspace-level name uniqueness and the 12-size cap are enforced in the app, so the migration can't fail on existing duplicates.
- **Variant ids.** These are written in a separate best-effort update after the line insert or replace. Shopify import keeps working if the columns don't exist yet.
- **Rejections.** Stored per order on the history row (`rejected_order_ids`).
- **AutoPack boxes stay traceable.** They're never written by the booking re-queue path, which can't write their evidence record.
- **Fixed in passing (requirement 4).** The re-queue path in `createShipmentsForOrders` used to overwrite a merchant's size with Shopify-derived dimensions. It no longer does.
- **Fixed in passing (existing bug).** `order-dimension-badge.tsx` called `isParcelArticle` without importing it.

Tests: `modules/autopack/*.test.ts` (33), `autopack-migration.pg.test.ts` (5, PGlite), `modules/shopify/orders-autopack.test.ts` (8), plus updated preset and dimension tests. Related suites: 1045 pass. 19 fail, all from earlier uncommitted work: `parcel-weight-booking` (18, `ceptSubmitIntentAt` filter not mocked) and `provider.search` (1).

Not done or not verified:
- The UI hasn't been checked in a browser. The `:3000` dev server is production, and local staging needs Docker.
- There's no UI page listing past boxes. The API exists: `GET autopack/history`, plus `verify` and `retire`.
- The re-queue manual-lock fix has no dedicated unit test.

Release order: apply the migration on staging, then deploy the code, then turn on `autoPackageSelection` for one canary org.
