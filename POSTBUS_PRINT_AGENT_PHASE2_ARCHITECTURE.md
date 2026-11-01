# PostBus Print Agent — Phase 2 architecture

## Choice

The desktop app uses opaque device tokens, not a second user-login system and not short-lived JWTs signed in the agent.

- Access token `pb_pdev_…`, 15 minutes, stored only as a SHA-256 hash.
- Refresh token `pb_pref_…`, 90 days, rotated on every refresh. The previous hash stops working.
- The agent keeps both in Windows Credential Manager. `settings.json` stores the selected printer and an optional API base URL only.

A JWT would add a signing key to operate and rotate. Opaque hashes match the existing `pb_print_` agent and can be revoked by deleting or ignoring the hash. The cost is a database read on each heartbeat.

## Flow

1. The agent generates a 32-byte verifier and sends it to `POST /api/v1/print-devices/pair/start`.
2. The server stores `sha256(verifier)` and `sha256(code)` and returns `XXXX-XXXX` for 10 minutes.
3. A merchant with `automation.manage` submits the code in Settings → Printing.
4. The server binds that challenge to the merchant’s organization. The code alone is not enough to finish pairing.
5. The agent polls with the verifier. After approval it calls exchange. One conditional update marks the challenge consumed. The response contains the tokens once.
6. Heartbeats every 30 seconds update `last_seen_at`. Online means an active device seen within 90 seconds. Revoked is a separate status.
7. Disconnect or merchant revoke marks the device revoked. Later refresh or heartbeat is rejected.

Multiple `print_devices` rows can belong to one organization. They do not replace the single legacy `print_agents` row and they do not claim jobs.

## Network

The agent calls `https://postbus.in` unless `settings.json` sets `apiBaseUrl` to that host or to localhost. It does not talk to Supabase directly.
