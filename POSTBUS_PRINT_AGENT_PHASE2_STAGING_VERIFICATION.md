# PostBus Print Agent — Phase 2 staging verification

Date: 15 October 2026

Status: **stopped**. No verified staging database is available. Integration tests were not executed. Production was not modified in this step. Phase 3 was not started. Nothing was deployed.

## Environment check (observed)

| Check | Result |
| --- | --- |
| Supabase MCP project URL | `https://hgacoeoovjxkzfbesmvl.supabase.co` |
| Matches forbidden production ref | Yes |
| Supabase development branches | None (`list_branches` returned an empty list) |
| Second Supabase project in this session | None |
| Local `.env.staging` database | Not a hosted staging project. The example file points at `127.0.0.1:55432`, which is not running here |

`lib/env/staging-isolation.ts` treats `hgacoeoovjxkzfbesmvl` as production and refuses to start when staging mode points at it. That guard was not executed against a live staging app because no staging URL was supplied.

## Code audit (read from the repository)

The migration `supabase/migrations/20261015120000_print_device_pairing.sql` only creates:

- `print_devices`
- `print_pairing_challenges`
- `print_device_sessions`
- `print_device_events`

It enables row-level security. Members can select devices and events for their organization. Challenges and sessions have no member policies. It does not alter `print_agents`, `print_jobs`, `print_settings`, or `automation_settings`.

Pairing approval, expiry, one-time exchange, refresh rotation, revocation, and organization binding are implemented in `modules/print/device-pairing.ts` and `modules/print/device-pairing-db.ts`. The desktop app calls `/api/v1/print-devices/*` and stores tokens in Windows Credential Manager. It does not claim print jobs.

Earlier unit tests, from the Phase 2 build, are not a substitute for staging:

- `modules/print/device-pairing.test.ts`: 14 passed, in memory.
- `print-agent-desktop` `cargo test`: 11 passed, including a Credential Manager round trip on this PC. The test secret was deleted.

## Already true on production (prior step, not repeated)

On 15 October 2026 the same migration was applied to `hgacoeoovjxkzfbesmvl` after an explicit request to deploy that SQL file. A follow-up read showed the four tables with RLS on, member policies only on `print_devices` and `print_device_events`, and `print_agents` still `UNIQUE (organization_id)`.

This verification pass did not run that migration again and did not write test rows.

`POSTBUS_PRINT_AGENT_PHASE2_RELEASE_REPORT.md` still says the migration was not applied. That sentence is out of date.

## Integration tests

Not run. There is no staging database to apply the migration to, and production writes are forbidden.

| Test | Result |
| --- | --- |
| Pairing approval | Not run |
| Pairing expiration | Not run |
| One-time redemption | Not run |
| Concurrent redemption | Not run |
| Organization isolation | Not run |
| RLS policies | Not run |
| Token refresh | Not run |
| Device revocation | Not run |
| Multiple device registration | Not run |
| Windows agent to dashboard pairing | Not run |
| Legacy Node agent against a live queue | Not run in this step |

Legacy behavior is unchanged in source: `print-agent/index.mjs` and the `pb_print_` routes were not edited for Phase 2. That is a code review finding, not a live print test.

## Staging setup required before any further test

Do not create a project from this session. The connected account is the production project, and a new project organization has not been verified.

1. In the Supabase organization you control, create a project whose ref is not `hgacoeoovjxkzfbesmvl`. A preview branch of the production project is still attached to production. Do not use one unless you explicitly approve that.
2. Send the staging project URL only, of the form `https://<ref>.supabase.co`. The ref must differ from `hgacoeoovjxkzfbesmvl`.
3. Grant this session access to that project (Supabase MCP linked to the staging project, or a gitignored staging env). Do not paste the production service-role key into the agent or the desktop app.
4. After the URL is checked, apply only `supabase/migrations/20261015120000_print_device_pairing.sql` to that project.
5. Run the Next.js app with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the staging project. Point the Windows agent `apiBaseUrl` at that app, not at `https://postbus.in`.
6. Use two staging organizations and two `automation.manage` users. Do not use live merchant data or real labels.

Permissions needed: project owner or developer on the staging project, SQL migration rights there, and no write grant used against `hgacoeoovjxkzfbesmvl`.
