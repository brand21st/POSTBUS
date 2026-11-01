# PHASE 3.3 — PARTNER PORTAL

Routes (compiled in Phase 3.2 build): `/partner`, `login`, `register`, `terms`, `dashboard`, `links`, `campaigns`, `referrals`, `commissions`, `payouts`, `profile`, `support`.

Status: **IMPLEMENTED LOCALLY**. Production data: **BLOCKED** (missing tables). `checked()` maps PGRST205 to “Partner reporting tables are not installed…” — not fabricated zeros.

`POSTBUS_AFFILIATES_ENABLED` must stay false on production until schema is applied. Enabling the flag without tables 404s partner APIs and can 503 webhook retries.

Registration / admin approval: code present; auto-approve **not** implemented. Not activated in production this phase.

UI/UX browser on `next start`: still **UNVERIFIED** this phase.
