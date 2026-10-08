# Isolated PostBus staging (local Postgres)

This cluster is **not** the production Supabase project `hgacoeoovjxkzfbesmvl`.
It listens only on `127.0.0.1:55432`.

## Start

```bash
node scripts/staging/provision.mjs
```

## Two workers + CEPT stub (no India Post)

```bash
node scripts/staging/cept-stub.mjs
```

In two other terminals, using `STAGING_ORG_ID` printed by provision:

```bash
set STAGING_ORG_ID=<uuid>
node scripts/staging/worker.mjs A
```

```bash
set STAGING_ORG_ID=<uuid>
node scripts/staging/worker.mjs B
```

Then `GET http://127.0.0.1:4099/stats` — `maxInFlight` must be `1`.

## Stop

```bash
node scripts/staging/stop.mjs
```

`INDIA_POST_BOOKING_BATCH_SIZE` must stay `1`.
