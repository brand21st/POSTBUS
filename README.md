# PostBus

Shopify-to-India Post shipping automation for Indian merchants. This repository is the full product: public marketing site, merchant dashboard, APIs, Supabase schema, and background workers.

Website: [postbus.in](https://postbus.in)

## Stack

- Next.js 16 (App Router) and React 19
- TypeScript
- Tailwind CSS 4
- Supabase (Auth, Postgres, Storage)
- Redis + BullMQ workers
- Zod, TanStack Query, pdf-lib

## Getting started

```bash
npm install
cp .env.example .env.local
npm run dev
```

Workers (separate process, requires Redis):

```bash
docker compose -f docker-compose.redis.yml up -d
npm run workers
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `npm run dev` — development server
- `npm run build` — production build
- `npm run start` — start production web server
- `npm run workers` — start BullMQ workers (`tsx` is a production dependency)
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

Web and workers run as separate processes. See [`infra/HOSTINGER.md`](infra/HOSTINGER.md). Apply new files in `supabase/migrations/` to the remote database before releasing API changes that depend on them.
