# PostBus Print Agent — API contracts

All routes stay under `/api/v1`. Merchant routes use the session cookie and tenant context. Agent routes use a bearer credential and the server-side service-role client. Responses keep the existing `{ success, data, message }` envelope from `lib/api/handler`.

## Already implemented

| Method | Path | Caller | Behavior |
| --- | --- | --- | --- |
| GET | `print-station` | Merchant | Connection, printer names, paper, copies |
| PATCH | `print-station` | Merchant `automation.manage` | Selected printer, paper, orientation, copies, auto-print flag |
| POST | `print-station/token` | Merchant `automation.manage` | Rotates the CLI `pb_print_` token. Returned once |
| POST | `print-agent/heartbeat` | Agent | Body `{ printers: string[] }`. Updates `last_seen_at` |
| POST | `print-agent/jobs/claim` | Agent | One pending agent job, or null |
| GET | `print-jobs/:id/pdf` | Agent | PDF bytes for that org’s job |
| PATCH | `print-jobs/:id` | Agent | `PRINTED`, `FAILED`, or `PENDING` |
| POST | `labels/:id/print` | Merchant | `enqueueManualPrintJob` |

Online means `last_seen_at` within `PRINT_AGENT_ONLINE_MS` (30 seconds).

## Additive routes

### `POST /api/v1/print-agent/pair/start`

No merchant session. Body: `{ deviceProof: string, deviceName: string, agentVersion: string }`.

Returns `{ code, expiresAt }`. Stores only hashes. Rate limited.

### `POST /api/v1/print-agent/pair/complete`

No merchant session. Body: `{ code, deviceProof }`.

If the dashboard has redeemed that code, returns `{ credential, agentId, organizationName }` once. Otherwise `{ status: "pending" }`.

### `POST /api/v1/print-station/pair`

Merchant session. Body: `{ code }`.

Binds the challenge to `ctx.organizationId`. Permission: `automation.manage`.

### `POST /api/v1/print-agents/:id/revoke`

Merchant session. Sets `revoked_at`.

### `POST /api/v1/labels/print`

Merchant session. Body: `{ labelIds: string[], idempotencyKey: string }`.

Creates one manual agent job per label that belongs to the organization and has a PDF. Rejects ids outside the org. Does not add unselected orders.

### Agent completion extension

`PATCH /api/v1/print-jobs/:id` accepts additional statuses `SUBMITTED_TO_SPOOLER` and `UNKNOWN` for the EXE. The Node CLI may keep sending `PRINTED`.

Heartbeat body may grow to:

```json
{
  "printers": [
    {
      "localId": "port-hash",
      "name": "Zebra ZD220",
      "connectionType": "USB",
      "status": "ready",
      "isDefault": false
    }
  ]
}
```

String arrays remain valid so the current CLI does not break.

## Errors

Use existing `ERROR_CODES`: `AUTH_REQUIRED` for a bad or revoked credential, `FORBIDDEN` for role failures, `VALIDATION_ERROR` for a bad code or unknown printer, `RESOURCE_NOT_FOUND` for a label outside the org.
