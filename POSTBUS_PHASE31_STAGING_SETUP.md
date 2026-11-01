# Staging setup (local only)

1. Copy `.env.staging.example` → `.env.staging.local`.
2. Fill isolated project URL and keys. Never production service role or `rzp_live_`.
3. `npm run dev:staging` (port 3001).
4. Remote SQL: `npm run staging:affiliate-apply` which **only** runs the gate today and exits 1.

`.env.staging.local` does not exist in this workspace (confirmed by fail-closed boot). Do not invent a project ref.
