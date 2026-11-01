# PostBus Print Agent — security

## Trust boundary

The packing PC is untrusted. It may be shared, lost, or malware-infected. It receives only:

- its own device credential
- PDFs for print jobs that credential is allowed to claim
- printer names it itself reported

It never receives the Supabase service-role key, India Post credentials, merchant passwords, or another organization’s labels.

## Pairing

- Code: cryptographic random, short, hashed at rest, expires, single redemption, attempt limit, rate limit per IP and per organization
- The agent must present the secret it created when the challenge was issued. A person who only sees the code cannot finish pairing
- Dashboard redemption uses the signed-in tenant context and `automation.manage` (OWNER, ADMIN, MANAGER)
- Revoke sets `revoked_at` and rejects the credential. The EXE must clear Credential Manager and show the pairing screen again

## Credentials

- CLI: existing `pb_print_` token, stored as `token_hash`, compared in constant time (`authenticatePrintAgent`)
- EXE: new credential in Windows Credential Manager, sent as `Authorization: Bearer` over HTTPS only
- Rotation and revoke are audited in `audit_logs`, same as `print_agent.token_rotated`

## Documents

- `GET print-jobs/:id/pdf` stays bound to the agent’s `organization_id` and that job id
- Reject non-PDF bytes (already done in `loadLabelPdfBytes`)
- Cap download size to the existing label file limit
- The agent prints only that downloaded file. It does not accept a URL from the user or from a job field

## Jobs

- Claim is conditional on `status = PENDING` and matching `organization_id`
- Idempotency key on manual enqueue stops double-clicks from creating two physical prints
- No automatic reprint after `SUBMITTED_TO_SPOOLER` or `UNKNOWN`
- Auto Label Printing remains off unless the merchant enabled the existing switch

## Desktop process

- No shell commands built from printer names without quoting (the current PowerShell fallback interpolates the path; the EXE must pass arguments as an array, as `pdf-to-printer` already can)
- Tauri capabilities limited to the print and credential APIs. No broad filesystem or arbitrary command scope
- Installer is not described as signed until a certificate is configured

## Tests that must fail closed

Cross-organization job id, reused pairing code, expired code, revoked device, PDF for another org’s label, and a job claimed twice by two agents.
