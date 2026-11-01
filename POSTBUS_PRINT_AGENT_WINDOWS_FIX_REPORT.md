# POSTBUS WINDOWS PRINT AGENT — DIRECT PRINT FIX REPORT

**Date:** 18 October 2026  
**Agent version:** 0.2.1  
**Scope:** Tauri Windows Print Agent + existing print reliability schema (no new migration)

---

## 1. Confirmed root cause

Physical “labels do not print” was **not** shown to be a manufacturer driver defect. Code-verified failures stacked on the agent path:

1. **Silent printer switch** — if the saved Windows queue was missing, the UI selected the default/first printer.
2. **Name-only routing** — `local_id` (`port|name`) was enumerated but unused; cloud jobs still use display name (protocol unchanged). Duplicate names could misroute.
3. **Silent poll failures** — claim errors were discarded (`Err(_) => return`) while the UI still showed Connected.
4. **Access token gap** — heartbeat/claim refreshed on “not connected”; PDF download and job ACK did not, so a 15-minute token expiry could fail after a successful claim.
5. **GDI raster path** — `CreateDCW` with a null DEVMODE; `StretchDIBits` stretched the page to named paper inches without aspect ratio; unknown paper silently became A6.
6. **False success** — `PRINTED` was ACKed when `EndDoc` returned success (spooler accepted a GDI document), not when paper exited.

Cloud device-bound claiming (`print_jobs.device_id`, stale `PRINTING` → `NEEDS_REVIEW`) was already in the repository. A paired agent still cannot claim `device_id` NULL jobs; that remains correct and is not a silent fallback.

---

## 2. Files inspected

- `POSTBUS_PRINT_AGENT_AUDIT.md`
- `print-agent-desktop/src-tauri/src/{lib.rs,printers.rs,print_pdf.rs,pairing.rs,credentials.rs,test_pdf.rs}`
- `print-agent-desktop/src/App.tsx`, `styles.css`
- `modules/print/service.ts`, `device-pairing.ts`, `device-pairing-db.ts`
- `lib/api/v1/print.ts`, `lib/api/v1/print-devices.ts`
- `supabase/migrations/20261018130000_print_job_reliability.sql`
- `modules/print/service.test.ts`

---

## 3. Files modified

- `print-agent-desktop/src-tauri/src/printers.rs`
- `print-agent-desktop/src-tauri/src/print_pdf.rs`
- `print-agent-desktop/src-tauri/src/pairing.rs`
- `print-agent-desktop/src-tauri/src/lib.rs`
- `print-agent-desktop/src-tauri/src/diagnostics.rs` (new)
- `print-agent-desktop/src-tauri/Cargo.toml`
- `print-agent-desktop/src-tauri/tauri.conf.json`
- `print-agent-desktop/src/App.tsx`
- `print-agent-desktop/src/styles.css`
- `print-agent-desktop/package.json`
- `print-agent-desktop/package-lock.json`
- `modules/print/service.test.ts`

Unchanged: India Post booking, AWB, Shopify, WebUSB, Node `print-agent/index.mjs`, production migrations, claim authorization rules.

---

## 4. Windows printer detection findings

- `EnumPrintersW` (`PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS`, `PRINTER_INFO_2W`) remains the discovery API.
- Probe now fails with `GetLastError` instead of returning an empty list when Windows reports a real error.
- Fill is retried once on `ERROR_INSUFFICIENT_BUFFER` (122).
- USB / network classification is still inferred from the port name.
- Selection persists `selected_printer` **and** `selected_printer_local_id`.
- Missing saved printer: **no** fallback to Windows default.
- Offline queue: not selectable; job ACK is retryable `PENDING` only for offline/unavailable, not “not installed”.

Hardware hot-plug / USB thermal presence: **not executed** on a packing PC in this session. Local `cargo test` did enumerate this development machine’s installed queues (`windows_returns_installed_queues_without_invented_pdf_support`).

---

## 5. Print Agent connection findings

- Pairing (`pair/start` → approve → exchange), Credential Manager, 15-minute access / 90-day refresh: unchanged protocol.
- Heartbeat, claim, **PDF**, and **complete** now share `with_access` refresh on “not connected” and credential wipe on “disconnected”.
- Claim errors are logged, stored on pairing session message, and emitted to the UI.
- Device-bound claim is still enforced only on the server. Agent 0.2.1 does not claim unassigned jobs.

---

## 6. Print queue findings

- Cloud: `PENDING` → `PRINTING` (CAS + `claim_id`) → `PRINTED` / `FAILED` / retry `PENDING`; stale `PRINTING` → `NEEDS_REVIEW` (no auto-reprint).
- Agent no longer maps “not installed” to `PENDING` (that substring previously requeued forever).
- Duplicate AUTO / MANUAL idempotency: existing backend tests; not weakened.

---

## 7. Windows spooler findings

Path is still raster + GDI, not raw PDF-to-driver:

`OpenPrinterW` → `DocumentPropertiesW` (paper/orientation) → `CreateDCW` → `StartDocW` → `StartPage` → aspect-fit `StretchDIBits` → `EndPage` → `EndDoc` → `GetJobW`.

- Win32 failures include `GetLastError`.
- If the spooler job status includes error/offline/paper-out/deleted/blocked/user-intervention, ACK is `FAILED`.
- Otherwise ACK remains cloud `PRINTED`. UI copy is **Submitted to Windows spooler**, not physical proof.

---

## 8. PDF rendering findings

- Pages render via `PdfPage.Size()` and `PdfPageRenderOptions` at **300 DPI** (`RenderWithOptionsToStreamAsync`).
- Named sizes: A3, A4, A5, **A6**, 4x6. Unknown sizes **error** (no silent A6).
- Claim `orientation` is applied to paper inches / DEVMODE.
- Destination rectangle letterboxes into `HORZRES` × `VERTRES` (aspect preserved).
- Barcode scan quality is **not** certified (no hardware scan).

---

## 9. Fixes implemented

- Stable local printer identity in settings; fail instead of switching queues.
- Token refresh on PDF and ACK.
- Visible print-loop errors and a Print status card (connection, printer, queue, last attempt, last error).
- Refresh printers always visible; test print remains local synthetic 4×6 with confirm dialog.
- JSON-line log `%AppData%\…\print-agent.log` with token/URL redaction.
- Agent version **0.2.1**.

---

## 10. Tests passed and failed

**Passed**

- `cargo test` in `print-agent-desktop/src-tauri`: **20 passed**, 0 failed (paper map, aspect-fit, printer resolve, enum probe, redaction, pairing allowlist, credential manager, live EnumPrinters smoke on this PC).
- `npx vitest run modules/print/service.test.ts`: **29 passed**, including `stamps device_id from the selected Print Agent computer`.
- `npx tsc --noEmit` in `print-agent-desktop`.

**Failed**

- None in the suites above.

**Not run as pass/fail**

- Full Tauri NSIS install on a packing PC.
- Live PostBus claim → thermal/A4 print.
- Staging Coolify migration probe.

---

## 11. Hardware tests still required

Do **not** mark these passed until executed on real devices:

| Test | Status |
| --- | --- |
| Windows 10/11 packing PC, manufacturer driver | REQUIRED |
| USB thermal 4×6 | REQUIRED |
| A4 printer | REQUIRED |
| Multi-print A4 sheet | REQUIRED |
| Barcode scan of produced labels | REQUIRED |
| Agent reconnect after sleep | REQUIRED |
| Duplicate-name queues | REQUIRED |

---

## 12. Deployment compatibility requirements

- Staging/production API **must** already have `20261018130000_print_job_reliability.sql`. Do not apply a new migration for this agent fix.
- Deploy **backend first** if that migration is missing; then ship Print Agent **0.2.1**.
- If production lacks `print_jobs.device_id`, 0.2.1 will not print unassigned jobs (by design). That environment is **BLOCKED** until the reliability migration is applied — do not add a claim workaround.
- Leave the Node agent and WebUSB path on the same cloud protocol.
- Do not auto-deploy; operators reprint `NEEDS_REVIEW` from the dashboard.

---

## 13. Remaining risks

- `PRINTED` still means spooler-accepted, not “label on the parcel”.
- Driver rejection of DEVMODE paper will fail the job (intentional) and may need a tray/form configured in Windows.
- 300 DPI raster can still blur on some 203 DPI heads until hardware QA.
- Two agents with the same display name still require `local_id` selection on the PC; cloud continues to send names.
- Crash after `EndDoc` before ACK can still land in `NEEDS_REVIEW` (no automatic second print).

---

## FINAL VERDICT

**READY FOR STAGING**

Code failure paths (missing printer, unknown paper, claim error surfacing, non-retryable “not installed”, aspect-fit, token refresh on PDF/ACK) are implemented and covered by unit tests on Windows.

This is **not** a claim that physical shipping-label printing is verified. Hardware tests above remain open. Do not treat production packing as fixed until a packing PC prints a **synthetic** test page and a **staging** (non-customer) label on the target printers.
