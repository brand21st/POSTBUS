# PostBus — UI/UX Implementation Report

Date: 2 Nov 2026 · Companion to `POSTBUS_UI_UX_AUDIT_REPORT.md` and `POSTBUS_RESPONSIVE_TEST_REPORT.md`

## A. Summary

Presentation-only changes to the dashboard shell, navigation, a few shared components and six pages. Nothing is committed, pushed or deployed. No API, database, auth, permission, booking, billing or job code was changed.

Headline results (measured in the browser, merchant account, production data, read-only):

| Metric | Before | After |
|---|---|---|
| Sidebar width (expanded / collapsed) | 260 / 76 px | **232 / 64 px** |
| Nav visible at 1366×768 (expanded) | 327 of 680 px (8 items hidden) | **619 of 619 px (all visible)** |
| Nav visible at 1366×768 (collapsed) | — | **553 of 553 px** |
| Main content width at 1366 | 1091 px | **1119 px** expanded · **1287 px** collapsed |
| Main content width at 1024 | — (260 px sidebar) | **945 px** (rail by default) |
| Top bar height | 64 px | **56 px** |
| Routes with page-level horizontal overflow | 1 at 1366 · 3 at 320 | **0** at every tested width |
| Mobile drawer: dialog role / Escape / focus in / focus return | ✗ / ✗ / ✗ / ✗ | ✓ / ✓ / ✓ / ✓ |
| Unlabeled buttons on `/automation` | 16 | **0** |

## F. Issues fixed (per issue)

| # | Route | Viewport | Sev | Original problem | Implemented solution | Verified |
|---|---|---|---|---|---|---|
| 1 | All dashboard pages | 1366×768 | P0 | 8 nav items hidden below sidebar scroll | Compact items (32 px), merged footer, collapse button moved to logo row | ✓ nav 619/619 |
| 2 | All | ≥1024 | P1 | 260 px sidebar | 232 px expanded, 64 px rail | ✓ measured |
| 3 | All | ≥1024 | P1 | Collapse not remembered | `localStorage` `postbus.sidebar.collapsed`, read via `useSyncExternalStore` | ✓ survived reload |
| 4 | All | ≥768 rail | P1 | No tooltips in icon mode | Fixed-position tooltip on hover **and** keyboard focus (`role=tooltip`), not clipped by the scrolling nav | ✓ "Shipments" tooltip |
| 5 | All | 768–1023 | P2 | Dead "Collapse" button | Rail is fixed on tablets; toggle hidden there | ✓ no toggle at 768 |
| 6 | All | 1024–1279 | P1 | Wide sidebar on small laptops | Defaults to rail when there's no saved choice | ✓ 64 px at 1024/1100 |
| 7 | All | <768 | P1 | Drawer: no dialog semantics, Escape, focus | Rebuilt on Radix Dialog: focus trap, Escape, scroll lock, focus returned to menu button, slide animation | ✓ all four checks |
| 8 | All | 375×812 | P1 | Drawer nav cut off at "Manifest" | Same compact sidebar | ✓ 663/663 |
| 9 | `/admin/*` | <768 | P0 | No admin nav on mobile | Hamburger + Radix drawer with the admin sidebar | Typecheck/lint only (not a super admin) |
| 10 | `/admin/*` | ≥768 | P2 | Admin sidebar scrolled away | `sticky top-0 h-svh`, 232 px, compact items, `aria-current` | Typecheck/lint only |
| 11 | `/shipments/[id]` | 1366 | P1 | Page overflow to 1485 px | `PageHeader` wraps actions under the title when they don't fit | ✓ 0 overflow at 1366/1024/768/320 |
| 12 | `/integrations/google-sheets` | 320 | P2 | 384 px layout | Header row wraps; long API URL breaks | ✓ 320 |
| 13 | `/settings`, `/integrations/wati` | 320 | P2 | 336 px layout | Form grids use `grid-cols-[minmax(0,1fr)]` | ✓ 320 (settings) |
| 14 | `/orders/new` | 320 | P2 | 324 px layout | Same `minmax(0,1fr)` on 5 form grids | ✓ 320 |
| 15 | `/orders` | 1024–1279 | P2 | Filter selects truncated to "All…" | Search box `15rem` below xl | ✓ selects 146 px, full labels |
| 16 | Tables (`DataTable`) | all | P2 | Selected row barely visible | Rose tint + 3 px brand bar on the first cell + `aria-selected` | ✓ computed styles + screenshot |
| 17 | Shared dialogs | short screens | P2 | Dialogs could exceed the viewport | `DialogContent`: `max-h-[calc(100dvh-2rem)] overflow-y-auto` (dialogs with their own max-h/overflow keep theirs) | Code review |
| 18 | Shell | mobile | P1 | Banner + top bar pinned together (~200 px) | Banner scrolls with the page; only the top bar stays sticky. Trial banner is single-row on phones. | ✓ screenshot |
| 19 | Top bar | all | P3 | 64 px, fixed 288 px search | 56 px; search 192/240/288 px by breakpoint; workspace pill only ≥1280 | ✓ |
| 20 | Top bar | <768 | P2 | No page context | Current page title next to the hamburger | ✓ "Dashboard", "Orders" |
| 21 | `/dashboard` | <640 | P2 | Six full-width KPI cards | 2-column KPI and pipeline grids, tighter mobile padding | ✓ screenshot |
| 22 | `/automation` | all | P1 a11y | 16 nameless switches | `aria-label` from each card title | ✓ 0 unlabeled |
| 23 | Nav, breadcrumbs | all | P3 a11y | No current-page semantics | `aria-current="page"` | Code + DOM |
| 24 | `SideSheet` | all | P3 a11y | No Escape | Escape closes | Code review |
| 25 | Main content | ≥1600 | P3 | 1280 px cap, large gutters | 1400 px cap; padding 20/24/32 px by breakpoint (was 24/32) | ✓ 1920 screenshot |

## G. Sidebar improvements

- **Size:** 232 px expanded, 64 px collapsed rail.
- **Grouping:** "Shipping" (Orders → Tracking) and "Workspace" (Automation → Settings) headings. On the rail they become dividers. Grouping is presentation-only. `lib/dashboard/nav.ts` is unchanged, so all routes, the order of items, the AI Accountant add-on insertion, the Multi-print flag and plan-lock logic are exactly as before.
- **Footer:** Tutorials and Help side by side, with one workspace row (initials, name, email, plan badge) linking to Settings, as before. The separate "Current plan" card and duplicate profile card were merged into that row. The profile name and email stay available in the top-bar account menu. The YouTube-red Tutorials icon from your uncommitted change is preserved.
- **Active state:** rose tint + 2 px brand indicator + `aria-current="page"`.
- **Collapse:** button in the logo row (expanded) or at the bottom of the rail. Remembered per browser. Smart default by width.
- **Tooltips:** visible on hover and keyboard focus. Locked items read "… (upgrade to unlock)". The support unread count becomes a dot on the rail.
- **Mobile:** same sidebar inside an accessible Radix drawer (280 px, max 85vw).

## H. Responsive improvements

| Width | Behaviour |
|---|---|
| <768 | Drawer nav; sticky 56 px top bar with page title; banner scrolls away; 2-column KPIs |
| 768–1023 | Fixed 64 px rail with tooltips |
| 1024–1279 | Rail by default (expandable, remembered) |
| ≥1280 | 232 px sidebar by default (collapsible, remembered) |
| ≥1600 | Content capped at 1400 px, centered |

## I. Shared component improvements

`PageHeader` (wrapping actions) · `DialogContent` (viewport-safe height) · `DataTable` (selected rows) · `SideSheet` (Escape) · `TrialStatusBar` (single row on mobile) · `Topbar` · `Sidebar` · `MobileNav` · `AdminShell`/`AdminSidebar`.

## J. Accessibility improvements

Dialog semantics, focus trap and focus return for both drawers · Escape to close (drawers, side sheet) · `aria-current` on nav and breadcrumbs · keyboard-visible tooltips on the icon rail · `aria-expanded` and labels on collapse controls · `aria-selected` on table rows · names for 17 switches · visible focus rings on all new nav controls · drawer animation respects `prefers-reduced-motion` (existing global rule).

## L. Test results

| Check | Result |
|---|---|
| `npx vitest run lib/dashboard components/dashboard components/orders` | **15 files, 102 tests passed** |
| ESLint on all 19 touched files | **0 errors.** 5 warnings, all present before this work (shell `me` dep, data-table unused var, orders page hook deps, orders/new `catalogItems`). |
| TypeScript (all app/components/lib/modules, tests excluded) | **0 errors in touched files.** 2 errors elsewhere: `components/shipments/booking-retry-panel.tsx(100)` (`"destructive"` variant) and `modules/autopack/memory-supabase.testkit.ts(50)`. Neither file was touched here. `booking-retry-panel.tsx` and `shipments/page.tsx` became modified during this session by someone else. |
| Hydration errors in console | None |
| Other console errors | PostHog requests blocked by CSP. These existed before and aren't related to this work. |
| Automated a11y tool (axe/Lighthouse) | **Not run.** No axe dependency in the repo, and adding one was out of scope. DOM checks (names, roles, focus) were scripted instead. |
| Full `npm test` / `next build` | **Not run.** Full vitest is known to flake on PGlite files, and the build is memory-heavy alongside the dev server. |

## M. Files modified by this work

Presentation only:

- `components/dashboard/sidebar.tsx` *(file already had an uncommitted one-line change, which is preserved)*
- `components/dashboard/mobile-nav.tsx`
- `components/dashboard/shell.tsx`
- `components/dashboard/topbar.tsx`
- `components/dashboard/page-header.tsx`
- `components/dashboard/data-table.tsx`
- `components/dashboard/side-sheet.tsx`
- `components/dashboard/trial-status-bar.tsx`
- `components/dashboard/auto-label-printing-card.tsx` (aria-label only)
- `components/ui/dialog.tsx`
- `components/admin/shell.tsx`, `components/admin/sidebar.tsx`
- `app/globals.css` (drawer keyframes)
- `app/(site)/dashboard/page.tsx` *(had uncommitted changes, which are preserved; only grid/padding classes edited)*
- `app/(site)/dashboard/orders/page.tsx` *(had uncommitted changes, which are preserved; one class on the search input)*
- `app/(site)/dashboard/orders/new/page.tsx` (grid classes)
- `app/(site)/dashboard/automation/page.tsx` (aria-labels)
- `app/(site)/dashboard/settings/page.tsx`, `app/(site)/dashboard/integrations/wati/page.tsx` (grid class)
- `app/(site)/dashboard/integrations/google-sheets/page.tsx` (wrap classes)
- New: `docs/ui-audit/*.jpg|png` (screenshots) and these three reports.

## N. Remaining issues (not fixed)

1. **Super Admin shell**: visually unverified (no admin login). Needs a check by a super admin at 375 and 1366.
2. **WhatsApp support widget** overlaps table rows bottom-right and sits above the open mobile drawer. It's injected by a third-party script. Its z-index/position should be changed where it's configured, or it should hide while a drawer/dialog is open.
3. **Small touch targets** (<24 px): table checkboxes (16 px) and compact chips on Orders, Shipments, Labels and Manifest detail. Enlarging the checkbox hit area changes the dense table rhythm and should be a deliberate design decision.
4. **Orders table at ≤1366** still scrolls horizontally inside its container (12 columns). The intended remedy is the existing "Columns" menu, or a sticky first/last column (`Actions`). Sticky columns weren't added because the table has resizable columns and row-click logic that need careful testing.
5. **Card padding** stays at 24 px globally (`components/ui/card.tsx` is shared with marketing pages).
6. **Modals and empty/error/loading states** weren't opened one by one (several are one click from production booking). They should be checked on staging.
7. **PostHog CSP** blocks every event, which floods the console (not UI; config issue).
8. **Locked nav items** use a blur effect that reduces legibility. It's kept as a deliberate upsell pattern; consider a muted label plus lock icon instead.

## O. Scope compliance

- No backend, API route, database, migration, RLS, auth/session, permission, booking, label-generation, tracking, billing, queue or webhook code changed.
- `lib/dashboard/nav.ts` (routes, order, role/plan visibility) is untouched. Sidebar visibility logic (`lockedFeatureForPath`, `multiUpPrintEnabled`, AI Accountant add-on check) was moved verbatim.
- Form submission, validation rules and calculations are untouched. Edits in form pages are CSS grid classes only.
- No dependencies added. No environment or deploy config changed.
- Browser testing was read-only on production data. One table row checkbox was toggled and cleared (local state only).

## P. Git and deployment status

- Branch `fix/auth-session-stability`. **Nothing committed, nothing pushed, nothing deployed.**
- The pre-existing uncommitted work in the tree was left intact.
- The original `next dev` on `:3000` exited during the session (probably memory pressure). A replacement `npm run dev` from `.claude/launch.json` is running on `:3000` with the same `.env.local`.
