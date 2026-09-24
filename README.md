# PostBus

Shopify-to-India Post shipping automation for Indian merchants. This repository is the full product: public marketing site, merchant dashboard, APIs, Supabase schema, and background workers.

Website: [postbus.in](https://postbus.in)

## Stack

- Next.js 16 (App Router) and React 19
- TypeScript
- Tailwind CSS 4
- Supabase (Auth, Postgres, Storage)
- Background jobs: Postgres-backed runner by default, Redis + BullMQ optional
- Zod, TanStack Query, pdf-lib

## Getting started

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Background jobs

`JOB_RUNNER` picks how rows in `background_jobs` get executed.

`database` (default) needs no Redis. Something must call the drain endpoint on a schedule:

```bash
CRON_SECRET=dev-secret npm run jobs:drain
```

Each call claims due jobs with `claim_background_jobs` (`FOR UPDATE SKIP LOCKED`), so
concurrent calls are safe and a runner that dies mid-job releases its lock after 15 minutes.

`redis` hands jobs to BullMQ instead, and nothing runs until the worker process is up:

```bash
docker compose -f docker-compose.redis.yml up -d
npm run workers
```

`GET /api/health` reports `jobs: "Warning"` when jobs stay due for over 10 minutes,
which is the signal that no runner is reaching the queue.

## Scripts

- `npm run dev` — development server
- `npm run build` — production build
- `npm run start` — start production web server
- `npm run workers` — start BullMQ workers, only for `JOB_RUNNER=redis` (`tsx` is a production dependency)
- `npm run jobs:drain` — run due background jobs once, for `JOB_RUNNER=database`
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript (`tsc --noEmit`)
- `npm run test` — Vitest

## Configuration

Copy `.env.example` to `.env.local`. `INTEGRATION_ENCRYPTION_KEY` is required in production. Do not commit secrets.

Edit [`lib/site-config.ts`](lib/site-config.ts) for public marketing metadata.

## Billing (Razorpay)

Subscriptions are stored per workspace (`subscriptions`, `plans`, `payments`, `billing_usage`). Amounts are integer paise. Yearly prices are 20% off the monthly list price.

Environment:

- `RAZORPAY_KEY_ID` / `NEXT_PUBLIC_RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET` (server only)
- `RAZORPAY_WEBHOOK_SECRET` (server only)
- `PLATFORM_ADMIN_EMAIL` — optional bootstrap for `/admin`

Webhook: `POST /api/webhooks/razorpay` (verify signature, store `event_id` uniquely, then apply). Daily sweep: `POST /api/cron/billing` with `CRON_SECRET`.

Merchant billing lives at `/dashboard/billing`. Super Admin is `/admin`.

Customer APIs (session + tenant): `GET /api/v1/billing/plans|subscription|usage|payments|invoices`, `POST /api/v1/billing/subscribe|verify|change-plan|cancel|resume`.

Super Admin APIs (platform_admins only): `/api/admin/overview`, `/accounts`, `/subscriptions`, `/payments`, `/plans`, `/revenue`, `/usage`, `/audit-logs`, `/razorpay`, `/trial-settings`.

Order quota is consumed on a successful India Post booking (`consume_order_quota`). Failed bookings do not count.

See [`docs/billing.md`](docs/billing.md) for the API surface.

## Routes

Marketing:

- `/` `/features` `/pricing` `/contact` `/privacy` `/terms`

Auth and product:

- `/login` `/register` `/forgot-password` `/reset-password` `/onboarding`
- `/dashboard` and nested merchant pages
- `/admin` — Super Admin console
- `{subdomain}.postbus.in` — published tracking pages (rewritten to `/track`)

## Deploy

Coolify runs the `Dockerfile` web container plus a scheduled task for the job runner. See [`infra/HOSTINGER.md`](infra/HOSTINGER.md). Apply new files in `supabase/migrations/` to the remote database before releasing API changes that depend on them.
