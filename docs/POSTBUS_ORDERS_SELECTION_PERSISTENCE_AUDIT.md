# POSTBUS — Orders Page Pagination & Selection Persistence Audit

**Route:** `/dashboard/orders`  
**Date:** 10 October 2026  
**Type:** Read-only source audit (no implementation, no data changes, no live merchant actions)  
**Status:** PARTIAL (architecture and code paths verified; browser runtime of checkbox events not executed)

---

## A. Executive Summary

The Orders list lets a merchant tick checkboxes and then run bulk fulfill or India Post booking. Pagination is a React `page` number that refetches `/api/v1/orders`. Selected IDs live in a `useState` array on the page component.

Row-level checkboxes **merge** IDs into that array, so in isolation they *can* survive a page change. The header “select all” checkbox does **not**. It **replaces** the entire selection with only the IDs on the current page, or with `[]` when unchecked.

That is the main code defect against the expected cross-page selection model. Combined with checkboxes that only render for the current page, and a bulk toolbar that only appears when two or more IDs are selected, merchants can reasonably conclude that “page 1 selections disappeared” as soon as they open page 2.

Pagination is **not** stored in the URL (unlike Inventory products). Browser back/forward and leaving the route do not restore page or selection. Selection is not written to `sessionStorage` or `localStorage`.

URL query params alone will not fix this. The selection model in `DataTable` must treat visible rows and the full selected-ID set as two different things.

---

## B. Verified Root Cause

### What is verified

1. **Selection owner:** `selected` / `setSelected` in `app/dashboard/orders/page.tsx` (`useState<string[]>([])`).
2. **No `useEffect` clears `selected` when `page` changes.** Fetching the next page does not assign `setSelected` except after a successful bulk fulfill.
3. **Row checkbox (desktop):** merges `row.id` into `selectedIds`.
4. **Header checkbox (desktop):** replaces the whole array with `visibleIds` or `[]`.
5. **Row checkbox (mobile):** merges correctly; there is **no** mobile select-all.
6. **Stable IDs:** `getRowId={(row) => row.id}`; list mapping keeps database `id`.
7. **Pagination:** offset-based (`(page - 1) * pageSize` … `range(from, to)` in `listOrders`). Page number is React state, not a query param.

### Precise defect (header select-all)

File: `components/dashboard/data-table.tsx`  
Function: `DataTable` → selectable column `_select` → `header` `onCheckedChange`

When `selectedIds` is provided (Orders always passes it):

```ts
onSelectionChange?.(value ? visibleIds : []);
```

- Check: parent selection becomes **only** the current page’s row IDs.
- Uncheck: parent selection becomes **`[]`**, including IDs that were selected on other pages.

Orders wires this as:

```ts
selectedIds={selected}
onSelectionChange={setSelected}
```

So a header click overwrites `selected` instead of union / subtract.

Row cells in the same file **do** merge:

```ts
value
  ? Array.from(new Set([...selectedIds, row.id]))
  : selectedIds.filter((id) => id !== row.id)
```

Mobile cards in `OrdersPage` use the same merge pattern via `setSelected((current) => …)`.

### What this means for the reported bug

| User action | What the source does |
| --- | --- |
| Tick individual rows on page 1, then go to page 2 | `selected` should still hold page 1 IDs. Page 2 checkboxes are unchecked because those IDs are not in the new `data`. Sticky bulk bar shows only if `selected.length >= 2`. |
| Use header “select all” on page 1, then use header on page 2 | Page 1 IDs are **discarded**. This matches “selections disappear.” |
| Use header “select all” on page 1, then only change page | Source does **not** call `setSelected` on `onPageChange`. Selection *should* remain in memory. Checkmarks on page 2 will be empty. |

### Not runtime-verified

Whether a **controlled** Radix checkbox (`components/ui/checkbox.tsx` wrapping `@radix-ui/react-checkbox`) emits `onCheckedChange(false)` when `checked` flips from `true` / `"indeterminate"` to `false` because the visible rows changed. The source does not show an explicit page-change reset. If that event fires, it would call `onSelectionChange([])` and wipe selection on every page change after a full-page select. That path was **not** confirmed in a browser.

Leaving `/dashboard/orders` (order detail, other nav, refresh) **will** reset selection because it is component-local `useState`. That is verified by architecture, not by a live click-through.

---

## C. Current Architecture

### Route and shell

| Piece | Path | Notes |
| --- | --- | --- |
| Page | `app/dashboard/orders/page.tsx` | Client component `OrdersPage` (default export). `"use client"`. |
| Layout | `app/dashboard/layout.tsx` | Server layout + `DashboardShell`. No `key` that remounts children on page number. |
| Detail | `app/dashboard/orders/[id]/page.tsx` | Navigating here unmounts the list. |
| New / links | `app/dashboard/orders/new/page.tsx`, `customer-links/page.tsx` | Same. |

No `app/dashboard/orders/layout.tsx`.

### Table, pagination, selection

| Piece | Path | Role |
| --- | --- | --- |
| Table | `components/dashboard/data-table.tsx` | `DataTable`, `paginationPages`, selectable column, pager. |
| Date filter | `components/dashboard/order-date-filter.tsx` | Sets `dateFilter`; parent resets `page` to 1. |
| KPI strip | `components/dashboard/order-kpi-strip.tsx` | Sets `status`; parent resets `page` to 1. |
| Bulk book UI | `components/bookings/bulk-india-post-booking.tsx` | Uses full `selectedIds`. |
| Checkbox | `components/ui/checkbox.tsx` | Radix controlled `checked` / `onCheckedChange`. |

### State on `OrdersPage`

| State | Storage | Survives pagination? | Survives route leave / refresh? |
| --- | --- | --- | --- |
| `page` | `useState(1)` | Yes (it *is* the page) | No |
| `pageSize` | `useState(20)` | Yes | No |
| `search` / `debounced` | `useState`; `q` read from URL | Debounce sets `page` to 1 | `q` re-read from URL; rest no |
| `status`, `source`, `payment`, `dateFilter` | React state | Yes | No |
| `selected` | `useState<string[]>([])` | Intended yes; header replace can wipe | No |
| Column visibility | `localStorage` key `postbus.orders.columns` | Yes | Yes |
| Column widths | API `/api/v1/ui/table-layouts/orders` (+ legacy `localStorage`) | Yes | Yes |

URL usage today:

- `useSearchParams()` reads **`q` only**.
- Sync effect copies `q` into `search`.
- Search is **not** written back to the URL from the input.
- **`page` is not in the URL.**
- Workspace search can deep-link `/dashboard/orders?q=…` (`lib/api/v1/workspace.ts`).

Inventory already uses URL `page` / `pageSize` / filters (`app/dashboard/inventory/products-panel.tsx` `setParams` + `router.replace`). Orders does not.

### Data fetching

```ts
useQuery({
  queryKey: ["orders", page, pageSize, debounced, status, source, payment, activeFrom, activeTo, todayRange.from.toISOString()],
  queryFn: () => api(`/api/v1/orders?${toSearchParams({ page, pageSize, q, status, source, paymentStatus, from, to, includeCounts, todayFrom, todayTo, yesterdayFrom, yesterdayTo })}`),
  placeholderData: keepPreviousData,
})
```

- Client: `lib/hooks/use-api.ts` `api`, `toSearchParams`.
- API: `GET orders` in `lib/api/v1/commerce.ts` → `orderListQuery.parse` → `listOrders`.
- Server list: `modules/orders/service.ts` `listOrders` — **offset pagination** via Supabase `.range(from, to)`, `order("created_at", { ascending: false })`.
- Schema: `modules/orders/schema.ts` `orderListQuery` (`page` min 1, `pageSize` 1–100, optional `sort` unused by this UI).
- Envelope unwrap: `asPaginated` in `lib/dashboard/records.ts`.

`loading={query.isLoading && !query.data}` — with `keepPreviousData`, previous `data` remains, so the table is not swapped for the skeleton on page change. `fetching` shows a top bar.

The pager is driven by **`list.page` from the API payload**, not the React `page` state:

```ts
page={list.page}
onPageChange={setPage}
```

While the next page is in flight, the highlighted page can lag (placeholder still has the old `page`). That does not clear `selected`.

`DataTable` has **no** `key={page}`. Changing page does not remount `OrdersPage`. The inner table unmounts only when `loading` is true (no data) or `error` is set.

TanStack Table (`useTable` + `rowSelectionFeature`) is used for row models. When `selectedIds` is passed, checkbox `checked` is **not** taken from internal table selection.

### Bulk actions (client)

| UI | Threshold | Payload |
| --- | --- | --- |
| Header Ship + Bulk book | `selected.length === 1` | `ship.mutate({ orderIds: selected, action: "fulfill" })`; `BulkIndiaPostBooking selectedIds={selected}` |
| Sticky bar | `selected.length >= 2` | Confirm dialog → `bulkFulfill.mutate(selected)`; same bulk book component |
| Clear selection | sticky bar | `setSelected([])` |
| After bulk fulfill success | — | `setSelected([])` |

Single-row Ship in the actions column uses `[row.id]`, not the selection set.

### Bulk actions (server)

| Endpoint | Handler | Validation |
| --- | --- | --- |
| `POST /api/v1/orders/bulk/status` | `bulkUpdateOrderStatus` (`modules/orders/bulk-status.ts`) | Zod `orderIds` min 1 max **100**. Loads orders with `.eq("organization_id", ctx.organizationId).in("id", uniqueIds)`. Missing IDs → `failed`. Ineligible status → `skipped`. Fulfill via `createShipmentsForOrders`. Permission: `shipments.write`. |
| `POST /api/v1/shipments` | `createShipmentsForOrders` | Org-scoped `.in("id", orderIds)`. Empty → error. Missing org rows → not found. Quota check when enqueueing booking. |
| `POST /api/v1/bookings/validate` / `queue` | `validateOrdersForBooking` / `queueValidatedOrders` | Deduped IDs; max **500**. Throws if any ID is not in the workspace. |
| `GET /api/v1/bookings/summary?orderIds=` | `summarizeBulkBookings` | Org-scoped; IDs in **query string**; sliced to 500. |

Client IDs are not trusted as authority: the server re-loads by org. Pagination cannot make the server fulfill another merchant’s orders. It **can** make the client send a **wrong subset** if the UI wiped or replaced `selected`.

### Tests and docs

- **No** tests for `DataTable` selection merge, Orders pagination, or selection persistence.
- Backend bulk fulfill tests: `modules/orders/bulk-status.test.ts`.
- Permissions: `lib/api/v1-permissions.test.ts`.
- List query schema: `modules/orders/schema.test.ts`.
- No existing product doc for this behaviour. Operational reports live in repo root (`POSTBUS_*.md`); auth/billing docs live under `docs/`.

### Related pages (same table bug)

`DataTable` select-all replace is shared with:

- `app/dashboard/labels/page.tsx`
- `app/dashboard/inventory/products-panel.tsx`
- `app/dashboard/page.tsx` (recent orders; no `selectedIds` prop — uses internal table selection + `onSelectionChange`)

---

## D. Findings

### CRITICAL — Header select-all replaces the full selection set

**Evidence:** `components/dashboard/data-table.tsx` header `onCheckedChange` → `onSelectionChange?.(value ? visibleIds : [])`.  
**Impact:** Select-all on page 1, then select-all (or deselect-all) on page 2 drops page 1 IDs. Deselect-all on the current page clears **off-page** IDs. Cross-page bulk can run on the wrong set.  
**Fits expected behaviour:** No.

### HIGH — Visible rows and selected IDs are not modelled as separate sets

**Evidence:** Checkboxes bind only to current `data`. Sticky chrome is `selected.length >= 2` only. Header aria-label is “Select all visible orders” but the handler overwrites the global list.  
**Impact:** Page 2 never shows page 1 ticks (correct for those rows) while giving little feedback that off-page IDs remain. One selected order has header Ship/Bulk book only; no count on the table. Easy to believe selection was lost.  
**Fits expected behaviour:** Partially (IDs can remain; UX does not).

### HIGH — Pagination and filters are not URL state (Orders)

**Evidence:** `const [page, setPage] = useState(1)` in `OrdersPage`. Only `q` is read from `searchParams`. Inventory already uses `router.replace` for `page` / filters.  
**Impact:** Browser back/forward does not restore the list page. Opening an order and returning lands on page 1 with empty selection. Shareable/filtered links cannot include page.  
**URL params do not fix selection by themselves.**

### HIGH — Filter / search / date / page-size have no selection policy

**Evidence:** `resetFilters`, status/source/payment, `OrderDateFilter`, KPI strip, and search debounce set `page` to 1 and **do not** touch `selected`. Page size change: `setPageSize` + `setPage(1)` only.  
**Impact:** Selected IDs can sit outside the current filter. Bulk still sends those IDs. Server will skip/fail ineligible ones, but the merchant may think they selected “what I see.”

### MEDIUM — Client-submitted IDs plus bulk limits

**Evidence:** `bulkOrderStatusSchema` max 100; booking validate max 500; summary GET concatenates IDs in the query string.  
**Impact:** Large cross-page selections can fail validation or hit URL length on summary. Not a pagination wipe, but it bounds the “select across pages” design.

### MEDIUM — Pager uses API `list.page` during placeholder data

**Evidence:** `page={list.page}` with `keepPreviousData`.  
**Impact:** Highlighted page can stay on the previous number until the fetch completes. Rapid clicks can feel sticky. Selection not cleared by this.

### MEDIUM — Rapid page changes / races

**Evidence:** Each `page` is a distinct React Query key. Out-of-order responses apply to their own key; the rendered list follows the current `page`. `selected` is independent.  
**Impact:** Stale list rows are unlikely to overwrite selection. Possible brief mismatch between highlighted pager and rows. Unverified in browser.

### LOW — `DataTable` error/loading unmounts the table body

**Evidence:** Early returns for `loading` and `error` in `DataTable`.  
**Impact:** Parent `selected` remains. User cannot see ticks until data returns. Failed page request does not by itself clear selection.

### LOW — Column `useMemo` depends on a new `columns` array every render

**Evidence:** `columns` is built inline in `OrdersPage`; `columnDefs` depends on `columns`, `selectedIds`, `onSelectionChange`.  
**Impact:** Extra table work; not a demonstrated selection reset.

### INFORMATIONAL — Select-all is current page only

**Evidence:** `visibleIds = table.getRowModel().rows.map((row) => row.id)`; aria-label “Select all visible orders”. No “select all matching filters” control.  
**Impact:** Correct if product intent is page-scoped select-all. Must not be implemented as a silent all-matching-filter select.

### INFORMATIONAL — localStorage is for columns, not selection

**Evidence:** `COLUMN_STORAGE`, `WIDTH_STORAGE` only. No `sessionStorage` on this page.

### INFORMATIONAL — IDs are stable UUIDs from the database

**Evidence:** `mapOrder` spreads `row` (includes `id`); `getRowId={(row) => row.id}`. Not index-based keys for desktop rows. Mobile uses `key={row.id}`.

### INFORMATIONAL — Backend independently scopes by organization

**Evidence:** `bulkUpdateOrderStatus`, `createShipmentsForOrders`, `validateOrdersForBooking` all `.eq("organization_id", ctx.organizationId)`.

---

## E. Recommended Solution

Smallest safe change: **keep selection in memory on `OrdersPage`, fix `DataTable` select-all to merge/subtract visible IDs, and optionally put list coordinates in the URL.** Do not add a new state library. Do not put order IDs in the URL. Do not use `localStorage` for selection unless product later requires survival across sessions.

### State split

| State | Where | Why |
| --- | --- | --- |
| `page`, `pageSize`, `q`, `status`, `source`, `payment`, date range | URL query (like Inventory `setParams` + `router.replace`) | Share, back/forward, return from order detail to the same list page. Client-side navigation, not a full reload. |
| Selected order IDs | React state on `OrdersPage` (`string[]` or `Set<string>`) | Cross-page ticks without leaking IDs into history, logs, or shared links. |
| Column layout | Existing localStorage / API | Unrelated. |

`sessionStorage` is **optional** and only if product wants selection to survive leaving the route in the same tab (e.g. open order, then Back). The stated bug is pagination, not reload. Default: **no browser storage for IDs**.

### Selection model

```
selectedIds: Set<orderId>     // full intended set
visibleIds:  orderId[]        // current page, eligible rows
```

- Row on: `selected ∪ {id}`
- Row off: `selected \ {id}`
- Select all visible: `selected ∪ visibleIds`
- Deselect all visible: `selected \ visibleIds`
- Clear: `selected = ∅`
- After successful bulk: clear (already done for fulfill)

Keep `selectedIds` + `onSelectionChange` as the single API so Labels/Inventory gain the same fix.

### Why this fits

- Orders already owns `selected` above the table. Pagination already does not remount the page.
- The broken contract is only how the header writes that array.
- Inventory already shows the URL pattern for list coordinates.
- React Query already keys fetches by `page`; URL can drive `page` instead of (or in addition to) `useState`.

### Persistence lifecycle (proposed default)

| Event | Selection |
| --- | --- |
| Change page / page size | Keep |
| Change sort (if added later) | Keep |
| Change filter, search, date, KPI status | **Clear** (or confirm). Prefer clear so bulk matches the visible query. Product must confirm. |
| Bulk success | Clear (current fulfill behaviour) |
| Refresh / other tab | Empty |
| Leave route | Empty unless sessionStorage is explicitly chosen |

---

## F. State Transition Examples

Assume page size 20. IDs are UUIDs.

1. **Select A, B on page 1 (row ticks)**  
   `selected = [A, B]`. Sticky bar: “2 selected”.

2. **Go to page 2**  
   Fetch page 2. `selected` still `[A, B]`. No ticks on page 2. Sticky bar remains.  
   *Header select-all must not run `onSelectionChange([])` as a side effect of `checked` changing.*

3. **Select C, D on page 2**  
   Row merge → `[A, B, C, D]`.

4. **Return to page 1**  
   A and B checked; C, D remain in `selected`.

5. **Deselect B**  
   `[A, C, D]`.

6. **Header select-all on page 1 (after fix)**  
   Union with visible page 1 IDs. C and D remain.

7. **Header deselect-all on page 1 (after fix)**  
   Drop only visible page 1 IDs. C and D remain.

8. **Confirm bulk fulfill**  
   `POST /api/v1/orders/bulk/status` with `{ orderIds: [A, C, D], action: "fulfill" }`. Server loads those IDs for this org, skips ineligible, reports failed missing IDs. Client then `setSelected([])`.

**Broken today (header):** select-all on page 1 → `selected = visiblePage1`. Select-all on page 2 → `selected = visiblePage2`. A and B gone. Bulk books the wrong page.

---

## G. Edge Cases

| Scenario | Current (source) | Recommended |
| --- | --- | --- |
| Page loading (`keepPreviousData`) | Previous rows stay; selection unchanged | Same; do not disable ticks unless `error` |
| Page request fails | `DataTable` empty error; `selected` kept | Keep; do not auto-clear |
| Rapid page clicks | Query keys isolated | Same; bind pager to React/URL page, not placeholder `list.page` |
| Same order refetched | Same `id`; tick follows `selectedIds.includes` | Same |
| Order deleted / other org | Still in `selected` until bulk; server `failed` / not found | Drop unknown IDs from toast result; do not silently keep forever |
| Filters change | Selection kept, page 1 | Product: clear vs keep-with-banner |
| Sort | UI has no sort control; API `sort` unused | If added, keep IDs |
| Page size | Page 1, selection kept | Keep IDs |
| Refresh | Lost | Lost (unless storage chosen) |
| Leave and revisit | Lost | Lost by default; URL restores **page/filters** if implemented |
| Browser back | URL `q` only; page state not in history | URL page restores list page; selection still memory-only |
| Select all visible vs all matching filter | UI is visible-only; handler overwrites global set | Keep visible-only; copy must stay explicit |
| Ineligible IDs in bulk | Server skip/fail | Client may pre-filter using loaded row status when the row is cached |
| `GET bookings/summary?orderIds=` | All IDs in query | Prefer POST body if selection grows; out of scope for pagination fix |
| Single selection, other page | Header Ship still shows; table has no ticks | Show a persistent “1 selected” chip on all pages |

---

## H. Implementation Plan

Do not start until product answers in section J.

1. **Fix `DataTable` select-all (required)**  
   File: `components/dashboard/data-table.tsx`  
   Header: union on check, subtract `visibleIds` on uncheck. Keep row merge. Cover with unit tests (pure helper preferred).  
   Checkpoint: select page 1 + page 2 + back; header deselect page 2 keeps page 1.

2. **Pager source of truth (small)**  
   Pass React/URL `page` into `DataTable` instead of `list.page` for button highlight and prev/next. Keep `total` from API.  
   File: `app/dashboard/orders/page.tsx`.

3. **Cross-page selection chrome (small)**  
   Always show a selection summary when `selected.length > 0`, including count and “Clear”, not only when `>= 2`.  
   File: `app/dashboard/orders/page.tsx`.

4. **URL list coordinates (recommended, separate from IDs)**  
   Mirror Inventory: `router.replace` for `page`, `pageSize`, `q`, `status`, `source`, `payment`, date. Read on mount. Client-side only.  
   Files: `app/dashboard/orders/page.tsx`; optionally a tiny helper next to `toSearchParams`.  
   Checkpoint: page 2 in URL; Back from order detail returns to page 2; **selection still empty after detail unless step 6**.

5. **Filter vs selection policy**  
   Implement the chosen rule (clear on filter change, or keep + banner).  
   File: `OrdersPage` filter handlers / `resetFilters`.

6. **sessionStorage (optional)**  
   Only if leaving the route must keep ticks. Key must include organization id. Clear after bulk and on logout. Not `localStorage`.

7. **Bulk safety (if selections grow)**  
   Cap UI at 100 for fulfill to match Zod. Consider POST for booking summary. Unrelated to first checkbox fix.

8. **Regression tests**  
   See section I.

---

## I. Regression Test Plan

No live merchant orders. Use fixtures / component tests.

### Selection

- Merge row select across two mocked pages; assert parent IDs.
- Header select-all unions visible IDs only.
- Header deselect-all removes visible IDs only.
- Return to page 1 restores ticks from parent IDs.
- Clear selection empties the set.
- Mobile row toggle merges the same way.

### Pagination / URL (if implemented)

- Changing page updates fetch params and does not reset IDs.
- `?page=2` renders page 2 after mock fetch.
- `router.replace` (not full reload) on page change.
- Back/forward restores page (component or integration test with memory router if available).

### Filters

- Documented policy: either selection cleared on status/search/date, or preserved with banner.

### Bulk

- Existing `modules/orders/bulk-status.test.ts` still passes.
- UI passes the **full** selected array, not `list.items.map(id)`.
- Fulfill max 100 still enforced; extra IDs not silently truncated without message.

### Edge

- Placeholder data: selection unchanged while fetching.
- Error empty state: selection unchanged.
- After fulfill success: selection empty (current behaviour).

Manual UAT (after implementation, on a test org): the seven steps in the original expected behaviour, plus filter change and open-order-and-back.

---

## J. Final Risk Assessment

| Item | Notes |
| --- | --- |
| Radix `onCheckedChange` on controlled `checked` updates | Unverified. If it fires, header replace would wipe on every page change after a full-page select. Fixing header to subtract visible IDs still **must not** treat an unsolicited `false` as “clear all.” Guard: only update on user pointer/keyboard, or ignore header change when `visibleIds` identity just changed. |
| Changing `DataTable` affects Labels, Inventory, Home | Merge semantics are the correct default everywhere; still regression-test those pages. |
| URL pagination | `useSearchParams` can remount/suspend if the tree is not already consistent with Next.js; wrap carefully; Inventory is the template. Do not put IDs in the query. |
| Filter-keep vs filter-clear | Wrong default causes stale bulk. Needs a product decision. |
| Browser storage | `localStorage` would revive stale IDs on another day/device user. Avoid. |
| Runtime UAT | This audit did not click `/dashboard/orders` in a browser or call bulk APIs. |
| `GET bookings/summary` URL length | Risk if cross-page selection is large. |

**Dependencies:** `@tanstack/react-query` `keepPreviousData`; Next.js App Router `useSearchParams` / `useRouter`; shared `DataTable`.

---

## Appendix — Audit question checklist

1. Where stored? `OrdersPage` `useState<string[]>` named `selected`.  
2. Local to the page? Yes.  
3. Recreated on pagination? Component instance is not remounted by `setPage`. State is not re-inited.  
4. Does fetch reset selection? No direct assignment. Header checkbox can.  
5. Table remount on page change? Not via `key`. Loading/error early return unmounts the inner table.  
6. Derived only from visible rows? **Display** yes; **header write** yes (replace); **row write** no (full array).  
7. Replace vs merge? Header replaces; rows merge.  
8. Stable IDs? Yes, `row.id`.  
9. Survive rerender? Yes, `useState`.  
10. Survive leave and return? No.

Pagination: React state, offset-based, not in URL, client `setPage` + React Query (not a document reload). Page size 10/20/50. Sort not exposed on this page.
