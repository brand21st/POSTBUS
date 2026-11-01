# PostBus Print Agent — database design

Migrations will be written as new files under `supabase/migrations/`. They will not be applied to production until approved.

## Extend existing tables

Do not create a second job queue.

### `print_agents`

Today: one row per organization, token hash, `printers` jsonb, `last_seen_at`.

Add:

| Column | Purpose |
| --- | --- |
| `platform` | `windows` for the EXE; `node` for the CLI |
| `agent_version` | Installer version |
| `status` | `pending`, `active`, `revoked` |
| `revoked_at` | Set on disconnect |
| `device_public_id` | Non-secret id the dashboard shows |

Drop the unique constraint on `organization_id` only after the CLI and UI can target a specific agent id. Keep `token_hash` for the CLI. The EXE stores a separate credential hash issued after pairing.

### `print_jobs`

Keep `shipment_id`, `label_id`, `printer_name`, `source`, `organization_id`.

Add nullable columns:

| Column | Purpose |
| --- | --- |
| `device_id` | Which agent claimed it |
| `idempotency_key` | Merchant action id so a double click does not enqueue two jobs |
| `attempt_count` | Bounded retries |
| `spooler_submitted_at` | Set only after the driver accepted the document |

Extend the status check to include `SUBMITTED_TO_SPOOLER`, `CANCELLED`, and `UNKNOWN`, while still accepting `PENDING`, `PRINTING`, `PRINTED`, `FAILED`.

`PRINTED` stays for the current Node agent. New EXE completions write `SUBMITTED_TO_SPOOLER`. The UI must not label that state “printed on paper.”

Change `recoverStalePrintJobs`: if `spooler_submitted_at` is set, move to `UNKNOWN`. Only untouched claims return to `PENDING`.

### `print_settings`

Keep paper size, orientation, copies, and selected printer name. Add `direct_print_enabled boolean not null default false` so Direct Print is explicit and Auto Label Printing remains its own switch.

## New tables

### `print_pairing_challenges`

| Column | Notes |
| --- | --- |
| `id` | uuid |
| `code_hash` | never store the raw code |
| `device_proof_hash` | binds the code to the agent that requested it |
| `expires_at` | about 10 minutes |
| `attempt_count` | cap failed dashboard entries |
| `redeemed_at` | one-time |
| `organization_id` | null until a merchant redeems it |
| `agent_id` | set when redeemed |

Redeem in one transaction: lock the row, check expiry and attempts, set `redeemed_at` and `organization_id`, insert or activate `print_agents`.

### `print_job_events`

Append-only: `organization_id`, `print_job_id`, `event_type`, `event_message`, `created_at`. Types include `queued`, `claimed`, `download_ok`, `spooler_accepted`, `spooler_rejected`, `unknown`, `cancelled`, `reprint_requested`.

`public.printers` remains the WebUSB registry. Windows spooler printers stay in `print_agents.printers` (json) plus `print_settings.selected_printer_name`, matching the current heartbeat. A normalized `print_printers` table is optional and not required for phase 1.

## RLS

Follow `20260923100000_auto_label_printing.sql`:

- Select: `is_org_member(organization_id)`
- Settings and pairing redemption: OWNER, ADMIN, MANAGER
- Job insert from the dashboard: include OPERATOR, matching current print job writes
- Agent mutations: server-side service role after device auth, never a policy that trusts a client-supplied organization id

Indexes: `(organization_id, status, created_at)` already exists on jobs. Add `(device_id, status)` and a partial index on unredeemed challenges by `code_hash`.
