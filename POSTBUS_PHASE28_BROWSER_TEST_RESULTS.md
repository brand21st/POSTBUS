# PostBus Phase 2.8 browser results

Tool: headless Chrome via the DevTools protocol. Dev server: `npm run dev` on port 3000 after restart.

## Journey A — pricing

EXECUTED on `http://127.0.0.1:3000/pricing` at width 390.

- Client root committed.
- HMR handshake status 101.
- Yearly and monthly amounts matched the stored plan paise and used `/year` or `/month`.
- No payment was submitted.

`http://localhost:3000/pricing` was also executed before the origin allowlist and showed the same yearly amounts after a click.

## Journeys B, C, D, and E

UNVERIFIED. No synthetic merchant, admin, or affiliate session was signed in. The local dev server loads `.env.local`, and this phase did not create accounts or open billing pages as a real user.

FAQ `<details>` was confirmed in the earlier failing run. Sidebar, admin filters, partner copy, and unauthorized download clicks were not executed in a browser.

## Production build

UNVERIFIED. `next build` was not run while the dev server was using `.next`.
