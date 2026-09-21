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

## Routes

Marketing:

- `/` `/features` `/pricing` `/contact` `/privacy` `/terms`

Auth and product:

- `/login` `/register` `/forgot-password` `/reset-password` `/onboarding`
- `/dashboard` and nested merchant pages
- `{subdomain}.postbus.in` — published tracking pages (rewritten to `/track`)

## Deploy

Coolify runs the `Dockerfile` web container plus a scheduled task for the job runner. See [`infra/HOSTINGER.md`](infra/HOSTINGER.md). Apply new files in `supabase/migrations/` to the remote database before releasing API changes that depend on them.
