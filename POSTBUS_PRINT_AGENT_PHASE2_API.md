# PostBus Print Agent — Phase 2 API

All routes are under `/api/v1` and use the existing JSON envelope.

| Method | Path | Caller |
| --- | --- | --- |
| POST | `print-devices/pair/start` | Agent. Body: verifier, device name, platform, OS, agent version. Returns the code once. |
| POST | `print-devices/pair/poll` | Agent. Body: verifier. |
| POST | `print-devices/pair/exchange` | Agent. Body: verifier. Returns tokens once after approval. |
| POST | `print-devices/heartbeat` | Agent. `Authorization: Bearer` access token. |
| POST | `print-devices/refresh` | Agent. `Authorization: Bearer` refresh token. |
| POST | `print-devices/disconnect` | Agent. Revokes the device for that access token. |
| POST | `print-devices/pair/approve` | Merchant session, `automation.manage`. Body: `{ code }`. |
| GET | `print-devices` | Merchant session. |
| POST | `print-devices/:id/revoke` | Merchant session, `automation.manage`. |

Legacy routes `print-agent/heartbeat`, `print-agent/jobs/claim`, and `print-jobs/:id` are not handled by this module.

If the tables are absent, the server responds that device pairing is not enabled. It does not return SQL text to the client.
