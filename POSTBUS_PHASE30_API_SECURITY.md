# API security

Unchanged from Phase 2.9 plus origin loopback match. Session affiliate id only. Payout POST flag-gated.

Mutating tests must call `assertNonProductionMutationTarget` before writing to a URL. Vitest isolation: 4 passed.
