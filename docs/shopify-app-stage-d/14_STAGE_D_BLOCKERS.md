# 14 Stage D blockers

1. `.env.local` `NEXT_PUBLIC_SUPABASE_URL` is production project `hgacoeoovjxkzfbesmvl`. **No migrate.**
2. `SHOPIFY_PUBLIC_APP_CLIENT_ID` / `SECRET` not set in `.env.local`.
3. `SHOPIFY_EMBEDDED_APP_ENABLED` is not true locally (correct until isolation is fixed).
4. `shopify.app.toml` still has placeholder `client_id`.
5. No HTTPS tunnel / public app URL.
6. Existing Partner app install footprint on real merchants: NOT TESTED (human Dashboard check required).
7. Live iframe, token exchange, webhooks on `tuzzstore.myshopify.com`: not run.
8. Uninstall/reinstall tests require a **second** approval after install.

## Must change locally (you, not chat)

- Point Next at local Supabase `http://127.0.0.1:54321` (start it if needed).
- Add public-app client ID and secret to `.env.local`.
- Keep production flag false on hosted environments.

Then re-run `npx tsx scripts/stage-d-env-preflight.mts` and request approval of the checkpoint commands.
