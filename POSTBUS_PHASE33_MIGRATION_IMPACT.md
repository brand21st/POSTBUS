# PHASE 3.3 — MIGRATION IMPACT

| File | Purpose | Touches live billing? | Risk |
| --- | --- | --- | --- |
| 120000 | Affiliate tables, immutable ledger triggers, RLS, `affiliate_accrue` / `affiliate_create_organization` | New FKs to `payments`/`organizations`; no payment UPDATEs | **HIGH** (financial schema + SECURITY DEFINER org wrapper) |
| 121000 | Bind signup, claim payments, summary, payload expression index on webhooks | New index on `razorpay_webhook_events` | **MEDIUM** |
| 122000 | Lease columns + `claim_razorpay_webhook` | **Yes** — ALTER live webhook table | **HIGH** |
| 123000 | Partner records RPC + conversions view | No | **MEDIUM** |
| 124000 | Replace `affiliate_summary` / reconciliation report | No | **MEDIUM** |
| 125000 | Link UTM/landing + link stats | No (new table only after 120000) | **MEDIUM** |
| 130000 | Tax policies; `billing_audit_logs` IF NOT EXISTS | Inserts to audit only after RPCs run | **HIGH** (tax evidence path; flags must stay off) |
| 140000 | Invoice **schema** | New tables; issuance flag off | **HIGH** (legal numbering objects exist even if unused) |

Financial files are not classified LOW RISK.

Locks: `ALTER TABLE ... ADD COLUMN` on `razorpay_webhook_events` (4 rows) should be brief ACCESS EXCLUSIVE; still schedule a maintenance window. `CREATE INDEX` on webhook payload path: SHARE/SHARE UPDATE EXCLUSIVE — 4 rows, short.

Estimated duration: minutes on this row volume. Downtime: not required if flags stay off, **except** app versions that call `claim_razorpay_webhook` while `POSTBUS_AFFILIATES_ENABLED=true` before 122000 exists.

Rollback: no reverse SQL. Forward-only. Restore from backup/PITR if apply fails mid-chain. See rollback plan.

This phase **did not apply** any file.
