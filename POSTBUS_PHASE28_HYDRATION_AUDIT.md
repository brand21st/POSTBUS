# PostBus Phase 2.8 hydration audit

Next.js 16.3.8. React 19.2.8. App Router. Root layout is `app/layout.tsx`. Pricing UI is the client component `app/(marketing)/pricing/pricing-toggle.tsx`.

## What failed

Headless Chrome opened `http://127.0.0.1:3000/pricing`. The HTML showed monthly prices. Clicking Yearly left `data-billing-cycle=monthly` and `aria-pressed` unchanged. A native FAQ `<details>` element still opened. `document` had no `__reactContainer`. `window.next.turbopack` was true and the flight payload had been consumed.

The HMR socket `ws://127.0.0.1:3000/_next/hmr` failed during the handshake:

`Error during WebSocket handshake: net::ERR_INVALID_HTTP_RESPONSE`

The dev server log said:

`Blocked cross-origin request to Next.js dev resource /_next/hmr from "127.0.0.1".`

Next.js 16 waits for that socket's debug channel to close before it calls `hydrateRoot`. With the socket refused, the React tree never committed, so the toggle handler never registered. This is development-only. The production client does not use that debug channel.

The same page on `http://localhost:3000` received websocket handshake `101`, committed a React root, and updated the prices.

## Fix

`next.config.ts` sets `allowedDevOrigins: ["127.0.0.1"]`.

`proxy.ts` also excludes `_next/hmr` and `_next/webpack-hmr` from the session proxy matcher, so that path is not turned into a normal HTTP response.

No `suppressHydrationWarning` or `ssr: false` workaround was added.

## Verification after restart

Headless Chrome, viewport 390×844, `http://127.0.0.1:3000/pricing`:

- React root present.
- HMR handshake `101`.
- Yearly: `yearly=479040 ₹4,790.40/year`, `yearly=1439040 ₹14,390.40/year`, `yearly=3360000 ₹33,600.00/year`.
- Monthly again: `49900`, `149900`, `350000` with `/month`.

A local `next build` / `next start` pass was not run. The running dev server owns `.next`. The failing path is the development HMR debug channel, which the production bundle does not wait on. Production-build behavior is UNVERIFIED.
