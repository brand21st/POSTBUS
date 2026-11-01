# POSTBUS PHASE 3.2 — UI/UX RESULTS

Partner shell: `components/affiliates/partner-shell.tsx`, `partner-portal.tsx`.

## Implemented locally

Sidebar modules, dashboard cards, tables, campaign form, copy/share/QR actions, payouts disabled presentation, loading/empty/error distinction for missing schema vs empty data.

## Browser this phase

Isolated `next build` (`.next-verify`) is **not** a substitute for `next start` click-through. Production `next start` hydration on port 3001 remains **UNVERIFIED** until an isolated start is run after a successful verify build.

Prior Phase 3.1 evidence: yearly pricing toggle on `127.0.0.1` `next dev` showed 4790.40 / 14390.40 / 33600.00. That is **VERIFIED LOCALLY** on the dev server, not on the production bundle.

Tablet/mobile partner portal: **UNVERIFIED** this phase (no new browser pass after the typecheck fix).

Every payout withdraw control must stay disabled while `POSTBUS_AFFILIATE_PAYOUTS_ENABLED` is not `true`.
