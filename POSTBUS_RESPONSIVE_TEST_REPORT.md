# PostBus — Responsive Test Report

Date: 2 Nov 2026 · Browser: Claude in-app browser (Chromium), viewport emulation · Server: local `next dev` (`:3000`, production data, read-only) · Account: merchant VEYNCULT (signed in by the user)

## How it was measured

For each route the page was loaded, given 4–10 s to render, and a script recorded:

- `hs`: document scroll width if it exceeded the viewport (page-level horizontal scroll), otherwise 0. Scrolling *inside* `.overflow-x-auto` table containers is allowed and excluded.
- `vw`: the layout viewport width. On mobile emulation, a value above the device width means the page forced the phone to zoom out.
- `aside`: sidebar width (`-` = hidden, i.e. mobile).
- `nav`: visible / total height of the sidebar nav list. Equal values mean no hidden items.
- `main`: content column width. `hdr`: top bar height.

## Before (baseline)

| Width | Routes | Page overflow | Notes |
|---|---|---|---|
| 1366×768 | 37 | **1**: `/shipments/[id]` (1485 px) | Sidebar 260 px; nav **327/680** on every page; main 1091 px; header 64 px |
| 375×812 | 36 | **1**: `/integrations/google-sheets` (layout 385 px) | Drawer: no dialog role, Escape ignored, focus not moved; drawer nav cut at "Manifest" |
| 820 | — | not completed | Dev server became unresponsive (108 s per page); tablet collapse bug confirmed in code (`collapsed \|\| tablet`) |

`/admin` showed a blank "Not found" gate (not a super admin). `/dashboard/ai-accountant` returned 404 (add-on off).

## After

### 1366×768 (laptop): 25 routes

All: `hs0`, `aside232`, `nav619/619`, `hdr56`, main 1119 px (1134 on full-width pages).

`/dashboard`, `/analytics`, `/orders`, `/orders/[id]`, `/orders/new`, `/orders/bulk-excel`, `/orders/customer-links`, `/inventory`, `/shipments`, `/shipments/[id]`, `/ndr-rto`, `/labels`, `/labels/templates`, `/labels/customize`, `/labels/multi-print`, `/invoices`, `/invoices/new`, `/invoices/customize`, `/manifests`, `/manifests/[id]`, `/tracking`, `/automation`, `/support`, `/integrations` — **0 overflow**.

Collapsed rail at 1366: `aside64`, `nav553/553`, main **1287 px**, tooltip shown on hover and focus. The collapsed state survived a reload.

### 1920×1080 (desktop): 12 routes

`/dashboard`, `/orders`, `/integrations/{india-post, shopify, woocommerce, wati, vachat, postbus-whatsapp}`, `/billing`, `/settings`, `/tutorials`: **0 overflow**, `nav931/931`, content capped at 1400 px and centered.

### 1024×768 and 1100×768 (small laptop)

`/orders`, `/shipments/[id]`: `aside64` by default (no saved preference), main 945 px, **0 overflow**. Orders filter selects 146 px each with full labels ("All statuses", "All sources", "All payments"). Expand → 232 px; collapse → 64 px; preference stored and cleared correctly.

### 768×1024 (tablet): 31 routes

All `hs0`, `aside64` (fixed rail, no dead toggle), `nav845/845`, main 689 px (704 on full-width pages). Routes: dashboard, analytics, orders (+detail, new, bulk-excel, customer-links), inventory, shipments (+detail), ndr-rto, labels (+templates, customize, multi-print), invoices (+new, customize), manifests (+detail), tracking, automation, support, integrations (+shopify, woocommerce, google-sheets, developer), billing, settings.

### 375×812 (mobile)

`/dashboard`: `hs0`, header 56 px. Trial banner is single-row and scrolls away. KPIs 2 per row. Drawer: `role=dialog`, focus inside on open, Escape closes, focus returns to "Open navigation", nav **663/663**.

### 320×640 (smallest mobile): 9 high-risk routes

| Route | Before fix | After |
|---|---|---|
| `/dashboard` | — | `vw320 hs0` |
| `/orders` | — | `vw320 hs0` |
| `/orders/[id]` | — | `vw320 hs0` |
| `/orders/new` | `vw324` | **`vw320 hs0`** |
| `/orders/bulk-excel` | — | `vw320 hs0` |
| `/shipments`, `/shipments/[id]` | — | `vw320 hs0` |
| `/labels` | — | `vw320 hs0` |
| `/integrations/google-sheets` | `vw384` | **`vw320 hs0`** |
| `/settings` | `vw336` | **`vw320 hs0`** |

## Widths from the requested matrix not individually run

360, 390, 414, 820, 1280, 1440 and 1600 px were not swept route by route. Coverage is bracketed: 320 and 375 on mobile, 768 on tablet, 1024/1100/1366 on laptop, 1920 on desktop. The breakpoint logic (Tailwind `sm` 640 / `md` 768 / `lg` 1024 / `xl` 1280) changes only at the boundaries tested. 1280 px is the switch point to the expanded sidebar: with the 232 px sidebar, the content column there is 1048 px.

## Screenshots

`docs/ui-audit/`:

- Before: `before-dashboard-1366.jpg`, `before-orders-1366.jpg`, `before-shipment-detail-1366.jpg`, `before-dashboard-375.jpg`, `before-orders-375.jpg`, `before-mobile-drawer-375.jpg`
- After: `after-dashboard-1366.jpg`, `after-orders-1366.jpg`, `after-orders-1366-collapsed.jpg`, `after-shipment-detail-1366.jpg`, `after-orders-1024-before-filter-fix.jpg`, `after-orders-filters-1024.png`, `after-orders-selected-row-1024.png`, `after-dashboard-375.jpg`, `after-dashboard-375-scrolled.jpg`, `after-mobile-drawer-375.jpg`, `after-dashboard-1920.jpg`
