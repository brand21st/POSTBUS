# PostBus Print Agent — Phase 2 security

## Controls

- Pairing codes use a 32-character alphabet without `0`, `O`, `1`, or `I`, eight characters, hashed at rest.
- The verifier is 32 random bytes. Poll and exchange require that verifier. Knowing the code is not enough.
- Approval is limited to five failures per user inside the pairing window, plus the existing IP rate limit on the public routes.
- Exchange is one `UPDATE … WHERE status = 'approved'`. A second caller does not receive tokens.
- Refresh rotates the stored hash before issuing a new pair. A revoked device is rejected from the device row, including with an old refresh token.
- Device APIs resolve the organization from the token hash. A body field named `organizationId` is ignored.
- Public errors for a bad code are generic: “That pairing code is not valid.”
- Challenges and sessions have RLS enabled and no member policies, so the browser cannot read hashes. Devices and events are selectable by `is_org_member`.
- Tokens are not written to `settings.json`, localStorage, or URLs.
- Credential Manager round-trip was tested on this PC and the test secret was deleted afterward.

## What this phase does not do

The paired device cannot download labels or enqueue print jobs. Legacy `pb_print_` behavior is unchanged. The migration was not applied to production, so production pairing is not live.

## Residual risk

The in-process rate limit resets when the Next.js process restarts. That matches the current PostBus limiter. A staging pass should confirm the conditional update under two concurrent HTTP requests against a real database. That pass is blocked until staging exists.
