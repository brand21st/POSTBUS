# PHASE 3.3 — PERFORMANCE

No production load test.

Webhook table: 4 rows; adding two nullable columns and one expression index is negligible at current size.

`affiliate_click_events` indexes: `(affiliate_id, created_at)`, `(link_id, visitor, created_at)`. Dashboard `affiliate_summary` does multiple aggregates — acceptable at launch volume; 10k affiliates **UNVERIFIED**.

`background_jobs` already 91k rows — affiliate work must not add unbounded jobs without a later review.

PGlite ≠ production planner.
