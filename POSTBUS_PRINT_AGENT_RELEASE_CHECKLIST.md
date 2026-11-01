# PostBus Print Agent — release checklist

Production deploy stays gated. Completing this list is the readiness report for a later approval. It is not approval to ship.

## Build

- [ ] `cargo tauri build` produces a Windows EXE on a clean Windows runner
- [ ] Installer name is PostBus Print Agent
- [ ] Version is embedded and shown in the tray
- [ ] If no signing certificate is configured, the download page says the build is unsigned
- [ ] Uninstall removes the tray app and does not delete merchant labels on the server

## Staging

- [ ] Migration applied only to staging
- [ ] Pairing, revoke, single print, and bulk print pass `POSTBUS_PRINT_AGENT_TEST_PLAN.md`
- [ ] Node CLI still prints with `pb_print_`
- [ ] WebUSB jobs still skip the agent
- [ ] Browser print still works
- [ ] India Post booking unchanged
- [ ] Shopify sync unchanged
- [ ] Billing unchanged
- [ ] Service-role key is absent from the EXE (search the built binary)

## Production, only after written approval

- [ ] Migration reviewed and applied
- [ ] Next.js change deployed on the production Coolify branch
- [ ] Installer hosted on a versioned HTTPS URL
- [ ] Settings → Printing offers that URL
- [ ] Auto Label Printing default remains off for orgs that have not enabled it
- [ ] Rollback is “disable Direct Print,” not a schema drop

## Known non-goals at first release

- Proof of physical output
- macOS
- Raw ZPL as the default
- Signed installer, unless a certificate is supplied before release
