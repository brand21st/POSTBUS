# POSTBUS Tracking P0 — Coolify Deploy Plan

**NOT EXECUTED — APPROVAL REQUIRED.**

## Preconditions to re-verify

- App `mw9larpomkyonxzy1rk3h6jm`
- Auto-deploy **false** (verified this session)
- Live SHA currently `865d295d8401aa55a3b20c6a1f937ceda94d846a`
- Pin `git_commit_sha` to the **release commit**, not merely the branch name (prior deploy cloned a pinned old SHA while GitHub already had the new tip)

## After approval

1. Push `fix/tracking-ingestion-p0` (do not merge `india-post-true-bulk-candidate`).
2. Fast-forward `support-center-release` to the release SHA.
3. PATCH Coolify `git_commit_sha` to that SHA.
4. Confirm canary env vars **unset**.
5. Manual `POST /api/v1/deploy?uuid=mw9larpomkyonxzy1rk3h6jm&force=true`.
6. Wait `finished` + `running:healthy` + SHA match.
7. Health `GET https://www.postbus.in/api/health`.
8. **STOP.** Do not arm canary env. Do not fleet re-sync.

## Rollback

Redeploy `865d295d8401aa55a3b20c6a1f937ceda94d846a`. Do not delete tracking events.

## Database

No migration. Auth cooldown uses existing `background_jobs.last_error_code`.
