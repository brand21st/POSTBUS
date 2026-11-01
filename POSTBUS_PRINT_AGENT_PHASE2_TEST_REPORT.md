# PostBus Print Agent — Phase 2 test report

Date: 15 October 2026

## Automated

`npx vitest run modules/print/device-pairing.test.ts lib/api/v1-permissions.test.ts`

- Pairing file: 14 passed.
- Permissions file: passed, including the existing print-station assertions.

Covered in the pairing tests:

- Valid pair, poll, exchange, heartbeat.
- Invalid code.
- Expired code.
- Second exchange rejected.
- Wrong verifier cannot redeem an approved code.
- Second organization cannot approve the same code.
- Devices stay on the approving organization when the heartbeat body names another organization.
- Five failed approvals lock the next attempt for that user.
- Revoke rejects the old refresh token with `revoked`.
- Refresh rotation rejects the previous refresh token.
- Expired access and expired refresh tokens are rejected.
- Stale heartbeat is offline while authorization stays active.
- Two devices stay active together.
- Legacy `print-agent` paths still match `isPrintAgentApiPath`. `print-devices` does not. Approve requires `automation.manage`.

`cargo test` in `print-agent-desktop/src-tauri`: 11 passed.

- Verifier length and uniqueness.
- Credential JSON round trip.
- Windows Credential Manager save, read, and delete. The test secret was removed.
- API base URL allows `https://postbus.in` and localhost, and rejects other `http` hosts.
- Existing printer and PDF tests still pass.

## Not run

No staging database was available, so these were not executed against Postgres:

- Two concurrent HTTP exchanges.
- RLS as `anon` and as a member of another organization.
- End-to-end pairing from the installed EXE through `https://postbus.in`.

Those are release blockers, not passing evidence.
