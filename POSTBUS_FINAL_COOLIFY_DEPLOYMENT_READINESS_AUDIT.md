# PostBus final Coolify deployment readiness audit

Date: 2026-11-01  
Mode: **read-only**. No code change, no SQL write, no commit, no Coolify deploy, no service start/stop.

**Question:** Is the current PostBus release safe to deploy to production through Coolify right now?

**Answer: NO.**

---

## 1. Executive summary

Production Coolify is **not** on the previously observed SHA `a2169cd`. It is on:

- Branch: `release/shopify-partial-on-9dcb414`
- SHA: `1fd4073c2ba2c67ff76dff84d590327ce5d48f56`
- Message: *Import only Shopify currentQuantity lines and replace them atomically.*
- Auto-deploy: **false**
- Status: `running:healthy`
- HTTP `/api/health`: api and database Healthy; jobs / Shopify / India Post Warning; `build.commit` matches `1fd4073`

The local checkout is `fix/auth-session-stability` at `8a52c36` with a **dirty tree** (959 `git status --short` lines; 2791 untracked paths). That branch is **not** an ancestor of live `1fd4073`. Deploying it would replace live features.

The isolated worktree `D:\POSTBUS-address-norm-a2169cd` is still based on **`a2169cd`**, which **is** an ancestor of live `1fd4073` but **lags** seven commits, including Shopify line-item atomic replace, billing capture hardening, and booking auto-retry. Deploying that worktree would **roll live production backward**.

Production database **does not** have `address_manual_override` / `address_validation_status` / `line3`. Latest production migration is `20261101015108` (`replace_shopify_order_line_items`). Live application code **already contains** `shipping-contact.ts`, `historical-classify.ts`, and origin-before-barcode booking — while Shopify **insert still fabricates** `"Address pending"`, `"NA"`, padded PIN, and `"0000000000"`.

Backup/PITR remains **not visible** through the approved API. Staging Next and local Auth are **down** (stopped 2026-10-31).

**PRODUCTION DEPLOYMENT: NO-GO.**  
**CAN WE CLICK COOLIFY DEPLOY NOW? NO.**

---

## 2. Actual production status

| Item | Current evidence |
| --- | --- |
| Coolify UUID | `mw9larpomkyonxzy1rk3h6jm` |
| Coolify status | `running:healthy` (API 200) |
| Git branch | `release/shopify-partial-on-9dcb414` |
| Git SHA | `1fd4073c2ba2c67ff76dff84d590327ce5d48f56` |
| Auto-deploy | false |
| Health HTTP | api Healthy, database Healthy, redis Disabled, jobRunner database, jobs/shopify/indiaPost Warning |
| Health build.commit | `1fd4073c2ba2c67ff76dff84d590327ce5d48f56` (built 2026-11-01T01:54:38Z) |
| Supabase | `hgacoeoovjxkzfbesmvl` |
| Address normalization columns | **absent** |
| Latest migration | `20261101015108` |

Health warnings are **not** treated as a deploy GO. They are existing operational warnings, not proof of the pending release.

---

## 3. Current live Git SHA

`1fd4073c2ba2c67ff76dff84d590327ce5d48f56`

Tips after `a2169cd` (live contains all of these):

```
1fd4073 Import only Shopify currentQuantity lines and replace them atomically.
9dcb414 Install CI dependencies with npm install, matching the Dockerfile.
7687dc8 Harden billing so paid access needs a verified, captured payment.
c0be1e1 feat(booking): implement safe smart auto retry with validation and historical job protection
6184928 test(booking): keep live webhook persist from hanging booking unit mocks
674a4f1 fix(booking): block recovery of shipped and historical first bookings
fa51fda fix(booking): integrate safe booking worker and Excel provenance with main
```

`a2169cd` **is** an ancestor of `1fd4073`. Extra COD defaults from `a2169cd` remain in live history.

---

## 4. Local Git status

| Item | Value |
| --- | --- |
| Branch | `fix/auth-session-stability` |
| HEAD | `8a52c364cb7599ce787c013e188eeeb97a717da9` |
| Dirty `git status --short` lines | 959 |
| Untracked (`ls-files --others --exclude-standard`) | 2791 |
| Upstream | none |
| Ancestor of live? | **No** |

Isolated candidate worktree:

| Item | Value |
| --- | --- |
| Path | `D:\POSTBUS-address-norm-a2169cd` |
| Branch | `release/shopify-address-on-a2169cd` |
| HEAD | `a2169cd` |
| Based on current live? | **No** (behind `1fd4073`) |
| Committed release SHA? | **No** |

**RELEASE PACKAGING: BLOCKED**

---

## 5. Production vs local version comparison

| Question | Answer |
| --- | --- |
| Is local behind production? | **Yes.** Local HEAD is not in live history. Live is not in local HEAD history (`live_in_local_history:1`). |
| Would deploying local remove live features? | **Yes.** Would drop Shopify `currentQuantity` atomic replace, billing capture hardening, booking auto-retry, and related worker/Excel provenance. |
| Would deploying the a2169cd worktree remove live features? | **Yes.** Same seven-commit rollback. |
| Are extra COD / payment defaults on live? | **Yes** (in ancestry; production migrations `20261031052414` and `20261031054133`). |
| Address-normalization compatible with live SHA? | **Not as currently packaged.** Must be rebased onto `1fd4073`, not `a2169cd` or `8a52c36`. |

---

## 6. Release changeset dependency audit

The six-file set is **not sufficient**. Live `1fd4073` already has several of those modules, but **Shopify insert is still the fabricator**. The a2169cd worktree patched extra files; it is still the wrong base.

| Path | Purpose | On live `1fd4073`? | Required | Safe to ship from dirty/a2169cd tree? |
| --- | --- | --- | --- | --- |
| `supabase/migrations/20261030143000_shopify_address_normalization.sql` | Additive columns | **No** (not applied) | REQUIRED | SQL looks additive; **do not apply until backup + rebase** |
| `modules/shopify/shipping-contact.ts` | Classify / persist / booking block | **Yes** | REQUIRED | Live already has it; dirty copy may diverge |
| `modules/orders/historical-classify.ts` | NULL classify at booking | **Yes** | REQUIRED | Live skips persist if column missing (`if (!("address_validation_status" in input.address))`) |
| `modules/india-post/booking-run.ts` | Gate then origin then barcode | **Yes** (origin before `allocateNextBarcode` ~540) | REQUIRED | Must merge with live auto-retry, not replace with a2169cd |
| `modules/shopify/orders.ts` `insertAddress` | Stop fake PIN/name/street | **Still fabricates** at ~2072 | REQUIRED | **MISSING on live** |
| `modules/india-post/address-lines.ts` | line3 wrap | Needed by shipping-contact | REQUIRED | Present in isolated a2169cd tree |
| `modules/orders/service.ts` override/accept/restore | Merchant review | Partial / unverified vs live | REQUIRED | Dirty tree extras may not apply cleanly |
| `modules/india-post/bulk-booking.ts` | Address block before queue | Unverified vs live retry worker | REQUIRED | |
| `modules/shipments/service.ts` | Address block before enqueue | Unverified vs live | REQUIRED | |
| `lib/api/v1/commerce.ts` accept/restore/revalidate | Review API | Unverified vs live | REQUIRED | |
| `components/orders/address-review-panel.tsx` | Review UI | Unverified vs live | REQUIRED | |
| `modules/ai-accountant/gst.ts` `canonicalStateName` | State canonicalization | Live shipping-contact imports it | REQUIRED if shipping-contact used | |
| `20261007140001_*` / `20261029120001_*` | Local rename | Production already has other timestamps | UNRELATED | **Exclude** |
| `20261031105000` / `20261031120000` | Local payment/COD filenames | Production `20261031052414` / `20261031054133` | UNRELATED rename | **Exclude** |
| Dirty 850+ files | Unrelated | — | UNRELATED | **Exclude** |

**Dependency graph (required):**

```
migration 20261030143000
    → addresses columns
shipping-contact.ts
    → address-lines.ts
    → gst.canonicalStateName
    → orders.ts persist/refresh
    → historical-classify.ts
        → booking-run.ts (after payment gate, before origin/barcode)
        → bulk-booking.ts
        → shipments/service.ts
    → orders/service.ts (manual override + review)
        → commerce.ts routes
        → address-review-panel + order detail page
```

---

## 7. Shopify integration audit

**Result: FAIL for data safety on live. PARTIAL for HMAC.**

Evidence (live `1fd4073`):

```2072:2076:modules/shopify/orders.ts
      line1: address?.address1 || "Address pending",
      city: address?.city || "NA",
      state: address?.province || "NA",
      pincode: shopifyPincode(address?.zip),
```

```1199:1208:modules/shopify/orders.ts
export function shopifyPhone(...) { ... return "0000000000"; }
export function shopifyPincode(...) { return digits.padEnd(6, "0"); }
```

`shopifyAddressPersistence` / `insertNormalizedAddress` are **not** used on live insert (`git grep` empty).

Webhook HMAC exists: `lib/api/v1/inbound-webhooks.ts` ~91–106 `verifyWebhookHmac`.

Live also has `1fd4073` *Import only Shopify currentQuantity lines and replace them atomically* plus production migration `20261101015108`. That must be preserved.

Classification:

| Check | Status |
| --- | --- |
| HMAC | COVERED IN CODE (live) |
| No fake PIN/phone/placeholders | **FAIL on live** |
| Null GraphQL must not wipe stored address | NOT VERIFIED on live insert path |
| Merchant override column | **Column absent** |
| Duplicate webhook / stale updated_at | NOT EXECUTED on live SHA |
| Live Shopify import E2E | NOT EXECUTED |

---

## 8. Address normalization audit

**PARTIAL / FAIL.**

Live `shippingAddressBookingBlock` (**1fd4073**) classifies **live fields first** and allows empty stored status if live is READY:

- `NEEDS_REVIEW` / `INVALID` stored → blocked
- missing stored status + live READY → **allowed**

Dirty/worktree copy fail-closes unless stored status is READY. Those two behaviors **diverge**.

Live `ensureLegacyAddressValidation` returns in-memory classify without writing if `address_validation_status` is not on the row object — which is the production case because the column does not exist. Persist `update(...).is("address_validation_status", null)` would error if invoked against missing columns (`if (error) throw`).

Accept / restore / revalidate UI on live: **not independently verified** this pass.

AI suggestions: live shipping-contact still has `applyAiAddressSuggestion`; live insert path does not use `normalizeShopifyShipping`. Residual AI overwrite risk: **UNVERIFIED**.

---

## 9. Historical order safety audit

**HISTORICAL BOOKING COMPATIBILITY: UNSAFE / NOT VERIFIED for the pending packaged release.**

Live behavior (code inspection of `1fd4073`):

1. NULL validation status is tolerated if stored street/PIN/phone classify READY.
2. Persist of status is skipped when the column is absent from the selected row.
3. Invalid live fields should block before barcode (`shippingAddressBookingBlock` then `resolveIndiaPostOrigin` then `allocateNextBarcode`).
4. Shopify-imported rows may already contain **fabricated** PIN/phone/placeholders, so “READY” can be a lie.

Confirmed production counts (SELECT, 2026-11-01, no PII):

| Metric | Count |
| --- | --- |
| organizations | 183 |
| orders | 16,449 |
| addresses | 36,370 |
| shipments | 3,494 |
| booked shipments (`booked_at` not null) | 1,732 |
| orders without a booked shipment | 14,717 |

**Do not treat 14,717 as a booking queue.**

Estimates from existing columns (not new validation columns):

| Metric | Count | Label |
| --- | --- | --- |
| shipping-kind addresses | 36,360 | CONFIRMED |
| empty PIN | 0 | CONFIRMED — consistent with PIN padding |
| PIN not six digits | 0 | CONFIRMED — consistent with PIN padding |
| empty phone | 2 | CONFIRMED |
| empty line1 | 0 | CONFIRMED — consistent with `"Address pending"` |

**Can a merchant book a valid historical order after migration without re-entry?**  
Intended yes, if live fields are genuinely valid. **NOT VERIFIED** on current live SHA with the migration applied.

**Can an invalid historical address reach barcode/CEPT?**  
On live booking-run, live-field INVALID should block before allocate. Fabricated six-digit PINs can still look valid. **UNSAFE residual.**

**Can merchant edits be overwritten by historical classify?**  
Classify writes validation columns only (when present), not street. Shopify refresh is the overwrite risk; live insert never sets override. **UNSAFE until migration + persist path.**

---

## 10. India Post booking audit

**PARTIAL.** No live CEPT calls this audit.

Live `1fd4073` booking-run order (inspected):

1. Contract  
2. Pending payment block  
3. `ensureLegacyAddressValidation`  
4. `shippingAddressBookingBlock`  
5. `resolveIndiaPostOrigin` (failure → mark failed, **no allocate**)  
6. `allocateNextBarcode` if needed  
7. claim / CEPT  

That **matches the required barcode-safety order** on the single-booking worker path. Earlier a2169cd production did **not**; live now does.

Gaps:

- Bulk / Excel / auto-retry (`c0be1e1`) not re-traced line-by-line this pass.
- Live Shopify payload still can send padded PIN / placeholder street to CEPT.
- Isolated E2E was against **a2169cd worktree**, not `1fd4073`.

---

## 11. Barcode allocation audit

Live booking-run: address + origin **before** `allocateNextBarcode` (~line 540).  

**PASS for that function on `1fd4073`.**  
**FAIL as a release gate** because the packaged candidate is not this SHA, and import-time fake PINs remain.

---

## 12. Database migration audit

File: `supabase/migrations/20261030143000_shopify_address_normalization.sql`

Additive: `line3`, phone provenance, original/normalized jsonb, validation status/source/timestamps, review flag, errors jsonb, `address_manual_override` nullable with default false.

Tri-state documented. Audit-log backfill sets override true for `order.shipping_address_updated`. Recovery update sets false+null original_shipping back to NULL.

Does **not** touch barcodes, tracking, shipments, invoices.

**MIGRATION COMPATIBILITY: PASS as SQL review; NOT VERIFIED as applied.**  
**SCHEMA-FIRST: UNSAFE to deploy app-that-writes-columns before this migration.** Live already shipped classify code with a skip-if-missing-column guard.

---

## 13. Migration history conflicts

| Local / worktree name | Production applied | Action |
| --- | --- | --- |
| `20261007140001_whatsapp_order_payment.sql` | `20261007091614` | Do not push rename |
| `20261029120001_shopify_fulfillment_eligibility.sql` | `20261101015047` | Do not push rename |
| `20261031105000_user_order_payment_default.sql` | `20261031052414` | Do not push rename |
| `20261031120000_user_order_extra_cod_default.sql` | `20261031054133` | Do not push rename |
| `20261030143000_shopify_address_normalization.sql` | **absent** | Intended new file |
| (none locally grepped) | `20261101015108` replace_shopify_order_line_items | **Live-only; preserve** |

**MIGRATION HISTORY: CONFLICTED if `db push` from dirty tree. SAFE if only the one new file is applied after backup, from a tree that already contains 20261101 history.**

---

## 14. Production data impact

CONFIRMED (this audit):

- 183 orgs, 16,449 orders, 36,370 addresses, 3,494 shipments, 1,732 booked, 14,717 without booked shipment.

ESTIMATES:

- Near-zero empty PIN/line1 is **not** proof of quality; live insert pads and placeholders.
- Review volume after fail-closed deploy could be large if fabricated rows later fail real CEPT.

UNVERIFIED RISKS:

- Booking interruption if fail-closed app ships before backfill.
- Import failure if app writes missing columns (PostgREST schema cache).
- Label line3 unused until column exists.

---

## 15. Coolify configuration audit

| Check | Result |
| --- | --- |
| Correct UUID | Yes `mw9larpomkyonxzy1rk3h6jm` |
| State | running:healthy |
| Branch / SHA | `release/shopify-partial-on-9dcb414` / `1fd4073` |
| Auto-deploy | false |
| jobRunner | database (from health) |
| Env values | **not printed** |
| HTTPS sslip.io | previously 500; this audit used HTTP health 200 |
| Worker topology | **NOT VERIFIED** beyond health jobRunner=database |

**COOLIFY DEPLOYMENT COMPATIBILITY: NOT VERIFIED for the pending address release.** Current live app is a different SHA than the candidate.

---

## 16. Background worker audit

Health: `jobRunner: database`, jobs Warning.  
Live includes `c0be1e1` smart auto retry. Isolated a2169cd worktree **does not contain** those commits. Rolling that candidate would **remove** worker behavior.

Old app vs new schema: additive columns are generally compatible with older writers. New writers vs old schema: **unsafe**.

**WORKER COMPATIBILITY: NOT VERIFIED for the pending package.**

---

## 17. Authentication and RLS audit

Previous staging RLS 25/25 and browser login: **previous evidence**, environment now **down**.

Production privileges (SELECT, this audit):

- `authenticated` SELECT organizations: true  
- `service_role` SELECT/INSERT `shopify_connections`: true  
- `service_role` INSERT `tracking_pages`: true  

Local staging GRANT issues were **local CLI**, not production.

New review routes: must stay org-scoped; not re-tested on live SHA.

**AUTH/RLS: NOT VERIFIED on current live SHA this pass.**

---

## 18. TypeScript and build evidence

| Evidence | Scope | Use now |
| --- | --- | --- |
| Dirty-tree `build:verify` / 287 tests | `8a52c36` dirty | **Do not treat as this release** |
| Isolated worktree tsc 0, eslint targeted 0, `next build` 0, vitest 61 | **a2169cd worktree** 2026-10-31 | **Not live SHA** |
| Live health `build.commit` 1fd4073 | Production image | Live **is** built; **not** the pending migration app |

`ignoreBuildErrors`: not seen in `1fd4073` `next.config.ts` grep this pass.

**ISOLATED RELEASE BUILD ON CURRENT LIVE SHA: NOT VERIFIED**

---

## 19. Automated test coverage

Do **not** sum 287+186+74+36+25.

| Area | Classification |
| --- | --- |
| Shopify fake PIN/placeholder | COVERED IN UNIT on dirty/worktree; **NOT on live insert** |
| Shopify currentQuantity atomic replace | On live commit; **NOT in a2169cd candidate tests as the base** |
| Historical classify | COVERED on a2169cd worktree 61 tests |
| Booking origin-before-barcode | COVERED in live source + worktree tests |
| RLS 25/25 | PREVIOUS staging; NOT EXECUTED now |
| Accept/restore/revalidate | PARTIALLY covered in dirty tests; NOT EXECUTED on live SHA |
| Live Shopify webhook E2E | NOT COVERED |
| Label PDF | NOT EXECUTED |

---

## 20. Staging E2E evidence

Staging Next `:3001` and Auth `:54321` are **down** (stopped 2026-10-31). This audit **did not restart them**.

| Category | Last execution | Result | Blocks deploy? |
| --- | --- | --- | --- |
| Auth browser | 2026-10-31 on dirty staging | PASS then | Yes — not on live SHA, env down |
| RLS API | 25/25 previous | PASS then | Yes — stale |
| Shopify import UI | Incomplete | FAIL/INCOMPLETE | Yes |
| Address review UI | Incomplete | INCOMPLETE | Yes |
| Historical booking UI | Incomplete | INCOMPLETE | Yes |
| CEPT stub booking | 2026-10-31 isolated a2169cd worktree | PASS then (`EY880000030IN` stub) | Yes — wrong base SHA |
| Barcode safety stub | same | PASS then | Partial |
| Label PDF | wrap only | INCOMPLETE | Yes |

---

## 21. Backup and recovery status

Approved API: `list_migrations`, `execute_sql`, `get_project_url`, `get_advisors`, `list_branches` (`[]`).  
**No backup catalog, PITR timestamp, or retention.**

**BACKUP/RECOVERY GATE: NOT VERIFIED**  
**RESTORE DRILL: NOT VERIFIED**

---

## 22. Rollback compatibility

- App: Coolify auto-deploy is off; previous image/SHA can be redeployed **if** the image is retained. Not drilled.
- Schema: `20261030143000` is additive; rollback of app after migrate is possible; DROP is not the rollback.
- Deploying a2169cd **is not rollback** — it is a feature regression versus `1fd4073`.

---

## 23. P0 findings

| ID | Severity | Component | Evidence | Blocker |
| --- | --- | --- | --- | --- |
| P0-BASE | CRITICAL | Release base | Live `1fd4073`; candidate `a2169cd`; local `8a52c36` | YES |
| P0-PACK | CRITICAL | Packaging | No committed SHA; dirty 959/2791 paths | YES |
| P0-FAB | CRITICAL | Shopify insert | Live `orders.ts` ~2072 placeholders; `shopifyPincode` padEnd; `shopifyPhone` `0000000000` | YES |
| P0-MIG | CRITICAL | Schema | Columns absent; latest `20261101015108`; intended `20261030143000` not applied | YES |
| P0-BAK | CRITICAL | Recovery | No backup catalog via approved API | YES |
| P0-ROLL | CRITICAL | Live features | Deploy a2169cd/local would drop `1fd4073` line-item + billing + retry commits | YES |

---

## 24. P1 findings

| ID | Issue | Blocker |
| --- | --- | --- |
| P1-E2E | Staging down; no E2E on live SHA | YES |
| P1-HIST | 14,717 unbooked orders; fabricated fields inflate “valid PIN” | YES |
| P1-DIVERGE | Live booking block allows NULL stored status; dirty fail-closes | YES |
| P1-HISTFILE | Renamed local migrations vs production timestamps | YES if `db push` |
| P1-BUILD | Isolated build not on `1fd4073` | YES |
| P1-LABEL | Label PDF E2E not done | YES |
| P1-WORKER | Auto-retry worker not in a2169cd candidate | YES |

---

## 25. P2/P3 findings

| ID | Issue |
| --- | --- |
| P2-HEALTH | jobs/shopify/indiaPost Warning on live health |
| P2-HTTPS | sslip.io TLS previously 500 |
| P3-REPORTS | Many overlapping GO/NO-GO docs; none authorize this deploy |
| P3-ESLINT | Full-repo eslint historically hangs |

---

## 26. Thirty-gate matrix

| Gate | Status |
| --- | --- |
| 01 Current production SHA identified | **PASS** `1fd4073` |
| 02 Release based on live SHA | **FAIL** (`a2169cd` / `8a52c36`) |
| 03 Live features preserved | **FAIL** if those bases deploy |
| 04 Changeset isolated | **FAIL** |
| 05 All dependencies included | **FAIL** |
| 06 Migration history reconciled | **PARTIAL** |
| 07 Address migration compatible | **PARTIAL** (SQL review only) |
| 08 Manual overrides protected | **PARTIAL** (column absent) |
| 09 Shopify import/webhook safety | **FAIL** (fabricated insert) |
| 10 Historical booking | **PARTIAL** |
| 11 Barcode allocation order | **PARTIAL** (true on live booking-run; false as packaged release) |
| 12 Duplicate booking prevention | **PARTIAL** |
| 13 India Post compatibility | **PARTIAL** |
| 14 Auth/RLS | **NOT VERIFIED** (current) |
| 15 Tenant isolation | **NOT VERIFIED** (current) |
| 16 Authenticated staging E2E | **FAIL** (down) |
| 17 Shopify import E2E | **FAIL** |
| 18 Historical booking E2E | **PARTIAL** (old SHA stub) |
| 19 India Post stub E2E | **PARTIAL** (old SHA) |
| 20 Label E2E | **FAIL** |
| 21 TS on isolated live-base | **NOT VERIFIED** |
| 22 ESLint on isolated live-base | **NOT VERIFIED** |
| 23 Next build on isolated live-base | **NOT VERIFIED** |
| 24 Regression on isolated live-base | **NOT VERIFIED** |
| 25 Backup verified | **FAIL** |
| 26 Restore verified | **FAIL** |
| 27 Coolify compatibility | **NOT VERIFIED** for this release |
| 28 Worker compatibility | **NOT VERIFIED** |
| 29 Rollback verified | **PARTIAL** |
| 30 No P0/P1 | **FAIL** |

**Mandatory PASS count: 1/30.**

---

## 27. Production readiness score

**22 / 100**

(Live SHA identified; health process up; booking-run order improved on live; everything required to *ship this package* is red or stale.)

A score cannot override failed mandatory gates.

---

## 28. GO / NO-GO

**PRODUCTION DEPLOYMENT: NO-GO**

---

## 29. Exact remediation plan (do not implement in this audit)

### PHASE A — Do not deploy wrong trees

Stop any Coolify deploy from `fix/auth-session-stability` or `release/shopify-address-on-a2169cd`.

### PHASE B — Rebase isolation onto live SHA

Priority 1. New worktree from **`1fd4073`**. Port only:

- migration `20261030143000`
- Shopify insert/persist that **does not** fabricate
- override + review UI/API
- fail-closed vs live NULL policy **explicitly decided**
- bulk/shipment gates  
Preserve live line-item replace, billing capture, auto-retry.

### PHASE C — Staging E2E on that SHA

Auth, Shopify fixture import (no live shop), historical NULL, stub CEPT, barcode-before-fail, label PDF.

### PHASE D — Backup

Owner confirms PITR/backup time in dashboard. Restore drill to a **non-production** project.

### PHASE E — Isolated tsc / eslint / next build / vitest on the `1fd4073` candidate.

### PHASE F — After explicit approval: migrate `20261030143000` only, verify columns, then Coolify deploy **that SHA**, then workers if separate, then read-only smoke.

---

## 30. Next recommended engineering task

**Create a new isolated worktree from live `1fd4073` and port the address-normalization / non-fabricating Shopify insert onto it. Discard a2169cd as the production base.**

---

## 31. Conditions required before Coolify deploy

1. Candidate SHA is descendant of **current** live SHA (re-read Coolify first).  
2. Only `20261030143000` as new DDL; no renamed historical files.  
3. Live `insertAddress` placeholders removed on that SHA.  
4. Isolated tsc, targeted eslint, `next build`, booking/address tests pass.  
5. Staging E2E on that SHA.  
6. Backup/PITR verified; restore drill recorded.  
7. Explicit owner production authorization.  
8. Schema migrate then app deploy (expand then contract).

---

## 32. Final safety confirmation

This audit did not modify code, apply SQL, commit, push, start staging, book India Post, allocate production barcodes, or deploy Coolify.

---

## Reports inspected (present vs named)

Present in repo root (among others):  
`POSTBUS_SHOPIFY_PRODUCTION_READINESS_AUDIT.md`, `POSTBUS_P0_FIX_IMPLEMENTATION_REPORT.md`, `POSTBUS_P0_REGRESSION_TEST_REPORT.md`, `POSTBUS_PRODUCTION_REAUDIT.md`, `POSTBUS_SAFE_DEPLOYMENT_RUNBOOK.md`, `POSTBUS_BUILD_STABILITY_FINAL_REPORT.md`, `POSTBUS_STAGING_RUNTIME_E2E_REPORT.md`, `POSTBUS_PRODUCTION_RELEASE_COMPLETION.md`, `POSTBUS_HISTORICAL_ORDER_SAFETY.md`, `POSTBUS_MIGRATION_RECONCILIATION.md`, `POSTBUS_EXACT_RELEASE_MANIFEST.md`, `POSTBUS_STAGING_E2E_RESULTS.md`, `POSTBUS_PRODUCTION_ROLLBACK_PLAN.md`, `POSTBUS_FINAL_AUTHENTICATED_E2E_REPORT.md`, `POSTBUS_FINAL_PRODUCTION_GO_NO_GO.md`, `POSTBUS_FINAL_DEPLOYMENT_REPORT.md`, `POSTBUS_STAGING_E2E_FINAL_REPORT.md`, `POSTBUS_PRODUCTION_BACKUP_RECOVERY_REPORT.md`.

Earlier GO/NO-GO and 74/100 re-audit scores are **historical**. They are **not** current authorization. Live SHA has changed since those documents assumed `a2169cd`.
