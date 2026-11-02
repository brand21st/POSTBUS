# PostBus — Dashboard UI/UX Audit Report

Date: 2 Nov 2026 · Branch: `fix/auth-session-stability` (uncommitted) · Auditor: Claude (Opus 5.5)

## A. Executive summary

The merchant dashboard was audited in a real browser (local `next dev` on `:3000`, signed in by the user as merchant **VEYNCULT**) at 320–1920 px, plus a code read of the shell, navigation and shared UI components.

The biggest problems were in the **shell**, not individual pages:

1. **At 1366×768 (the most common laptop), the sidebar showed only 327 px of its 680 px nav list.** Invoices, Manifest, Tracking, Automation, Support, Integrations, Billing and Settings sat below a hidden scroll, because the sidebar footer (Tutorials, Help, plan card, workspace card, profile card, Collapse) took about half the column. Workspace and profile were also duplicated in the top bar.
2. The sidebar was **260 px** expanded, didn't remember the collapsed state, had no tooltips in icon mode, and on tablets the "Collapse" button did nothing (the tablet was forced to collapse).
3. The **mobile drawer** had no dialog role, no Escape-to-close and no focus handling, and the same footer problem hid half the nav.
4. **Super Admin had no navigation at all on mobile**, and its sidebar wasn't sticky.
5. A handful of real layout bugs: the shipment detail page overflowed horizontally at 1366 px, and three pages forced phones to zoom out at 320 px.

All of these were fixed. See `POSTBUS_UI_UX_IMPLEMENTATION_REPORT.md` and `POSTBUS_RESPONSIVE_TEST_REPORT.md`.

### Method and constraints (read this first)

- **Environment:** `.env.local` points at the **production** Supabase project, and local staging needs Docker, which isn't installed. The browser audit therefore ran against production data. It was **read-only**: navigation, resizing, measuring, opening and closing the nav drawer, and toggling one table checkbox (local UI state, then cleared). No booking, sync, payment, save or other mutating action was triggered.
- **Credentials:** the assistant did not type the password supplied in the request. The user signed in themselves in the browser pane.
- **Measurement:** each route was loaded and a script measured page horizontal overflow, sidebar width, visible-versus-total nav height, main content width, header height, elements overflowing the viewport, touch targets under 24 px, and buttons without an accessible name.

## B. Routes discovered (from `app/(site)/…/page.tsx`)

**Merchant dashboard (47):** `/dashboard`, `/analytics`, `/orders`, `/orders/[id]`, `/orders/new`, `/orders/bulk-excel`, `/orders/customer-links`, `/inventory`, `/inventory/covers/[id]`, `/shipments`, `/shipments/[id]`, `/ndr-rto`, `/labels`, `/labels/templates`, `/labels/templates/[id]`, `/labels/customize`, `/labels/multi-print`, `/invoices`, `/invoices/[id]`, `/invoices/new`, `/invoices/customize`, `/manifests`, `/manifests/[id]`, `/tracking`, `/automation`, `/support`, `/integrations`, `/integrations/{india-post, shopify, woocommerce, google-sheets, developer, wati, vachat, postbus-whatsapp}`, `/billing`, `/settings`, `/tutorials`, `/ai-accountant` + `/ai-accountant/{assistant, cod, expenses, exports, gst, ledger, reports, settings}` (all under `/dashboard`).

**Super Admin (20):** `/admin`, `/admin/accounts`, `/admin/accounts/[id]`, `/admin/{addons, affiliates, ai-credits, audit, booking-queue, india-post-webhooks, invoices, payments, plans, razorpay, revenue, settings, subscriptions, tax, trial, tutorials, usage}`.

**Other:** `/onboarding`, `/partner/*` (partner portal, out of scope), Shopify embedded app `app/(shopify)` (out of scope: separate Polaris shell).

There are no separate routes for "Reports", "Subscription management" or "Label editor". Those are covered by `/dashboard/billing`, `/dashboard/labels/customize` and `/dashboard/labels/templates/[id]`.

## C. Routes successfully tested in the browser

37 routes, each measured at **1366×768 before changes**. After changes: 1366 (25 routes), 768 (31), 375 (36 before), 320 (9 high-risk), 1024/1100 (orders, shipment detail), 1920 (12). Per-route numbers are in the responsive test report.

`/dashboard`, `/analytics`, `/orders`, `/orders/[id]`, `/orders/new`, `/orders/bulk-excel`, `/orders/customer-links`, `/inventory`, `/shipments`, `/shipments/[id]`, `/ndr-rto`, `/labels`, `/labels/templates`, `/labels/customize`, `/labels/multi-print`, `/invoices`, `/invoices/new`, `/invoices/customize`, `/manifests`, `/manifests/[id]`, `/tracking`, `/automation`, `/support`, `/integrations` and all 8 integration sub-pages, `/billing`, `/settings`, `/tutorials`.

## D. Routes not tested and why

| Route(s) | Reason |
|---|---|
| `/admin/*` (20 routes) | Signed-in account isn't a super admin. `/admin` renders the "Not found" gate. Admin shell changes were verified by typecheck/lint only, **not visually**. |
| `/dashboard/ai-accountant/*` (9) | Add-on not enabled for this workspace (route returns 404). |
| `/invoices/[id]` | Workspace has 0 sales invoices, so there's no ID to open. |
| `/labels/templates/[id]`, `/inventory/covers/[id]` | Not opened (no ID captured). The pages share the shell and PageHeader, which were fixed globally. |
| `/onboarding` | Signed-in workspace is already onboarded; visiting would redirect. |
| Open-modal states (booking, prebooking review, parcel editor, etc.) | Opening several of these is one click away from booking against production. Dialog sizing was fixed globally in `DialogContent` and verified by code, not by opening each modal. |
| Loading / error / empty states | Not forced, since that would need API mocking against production. |

## E. Issues discovered

Severity: **P0** blocks a task · **P1** major friction · **P2** noticeable · **P3** polish.

| # | Route / area | Viewport | Sev | Problem | Status |
|---|---|---|---|---|---|
| 1 | Sidebar (all pages) | 1366×768 | P0 | Nav showed 327 of 680 px. Eight primary items were hidden below a scroll. | Fixed |
| 2 | Sidebar | ≥1024 | P1 | 260 px expanded width; footer stacked 6 blocks (two duplicate the top bar). | Fixed |
| 3 | Sidebar | all | P1 | Collapsed state not remembered across reloads. | Fixed |
| 4 | Sidebar collapsed | ≥768 | P1 | Icon-only links had no visible tooltip; labels were `sr-only` only. | Fixed |
| 5 | Shell | 768–1023 | P2 | "Collapse" button shown but did nothing (state forced). | Fixed |
| 6 | Mobile drawer | <768 | P1 | No `role=dialog`, focus not moved, Escape didn't close, focus not returned. | Fixed |
| 7 | Mobile drawer | 375×812 | P1 | Nav reached only "Manifest" before the footer. | Fixed |
| 8 | Super Admin | <768 | P0 | No navigation at all on mobile (header had only title + account menu). | Fixed (unverified visually) |
| 9 | Super Admin | ≥768 | P2 | Sidebar not sticky; scrolled away on long pages. | Fixed (unverified visually) |
| 10 | `/shipments/[id]` | 1366 | P1 | Page overflowed horizontally to 1485 px. PageHeader actions were `nowrap`/`shrink-0`, and the title was squeezed. | Fixed |
| 11 | `/integrations/google-sheets` | 320/375 | P2 | Apps Script header buttons forced a 384 px layout (phone zooms out). | Fixed |
| 12 | `/settings` | 320 | P2 | Form grid sized to the phone field's min-content, giving a 336 px layout. | Fixed |
| 13 | `/orders/new` | 320 | P2 | Several form grids sized to input min-content, giving a 324 px layout. | Fixed |
| 14 | `/orders` filters | 1024–1279 | P2 | Status/source/payment selects squeezed to "All…" (unreadable). | Fixed |
| 15 | Data tables | all | P2 | Selected rows got only a 20 % ring, barely visible. No `aria-selected`. | Fixed |
| 16 | Dialogs (shared) | short screens | P2 | `DialogContent` had no max-height. 14 of 23 styled dialog variants could clip. | Fixed |
| 17 | Trial banner + top bar | mobile | P1 | Banner + top bar were sticky together: about 200 px permanently covered on a phone. | Fixed |
| 18 | Top bar | all | P3 | 64 px tall; fixed 288 px search box; workspace pill duplicated sidebar info. | Fixed |
| 19 | Top bar | <768 | P2 | No page title on mobile; the left side was just a hamburger. | Fixed |
| 20 | `/dashboard` KPIs | <640 | P2 | Six full-width 152 px KPI cards; about 900 px of scrolling for six numbers. | Fixed |
| 21 | `/automation` | all | P1 (a11y) | 16 switches had no accessible name. | Fixed |
| 22 | Nav / breadcrumbs | all | P3 (a11y) | No `aria-current="page"` on the active nav item or the last breadcrumb. | Fixed |
| 23 | `SideSheet` (inventory) | all | P3 (a11y) | No Escape-to-close. | Fixed |
| 24 | Main content | ≥1600 | P3 | Content capped at 1280 px, leaving very wide gutters with a 260 px sidebar. | Adjusted to 1400 px |
| 25 | WhatsApp support widget | all | P2 | Floating widget overlaps table rows and sits above the open mobile drawer. | **Not fixed**: third-party widget, see N |
| 26 | Orders table | ≤1366 | P3 | Table needs horizontal scroll inside its container (Est. shipping, Created, Actions). That's acceptable by spec. Sidebar savings give +28 px expanded / +196 px collapsed. | Mitigated |
| 27 | Many pages | all | P3 (a11y) | Touch targets under 24 px (table checkboxes, small chips): orders 57, manifest detail 74, shipments 41. | **Not fixed**: see N |
| 28 | Card padding (`p-6`) | all | P3 | 24 px padding everywhere is generous for a data dashboard. | Not changed globally (also used by marketing pages); tightened on dashboard KPIs only |
| 29 | Locked nav items | all | P3 | Labels of plan-locked items are blurred (`blur-[1px]`), which hurts legibility. | Kept: deliberate upsell design |
| 30 | Console | all | — | PostHog requests blocked by CSP (hundreds of errors per session). | Not UI; reported only |

## F–J

See `POSTBUS_UI_UX_IMPLEMENTATION_REPORT.md`.

## K. Screenshots

`docs/ui-audit/` — `before-*` and `after-*` pairs: dashboard 1366/375, orders 1366, shipment detail 1366, mobile drawer 375, plus after-only collapsed rail, 1024 filters, selected row, and 1920.
