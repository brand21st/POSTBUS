# PostBus Print Agent — architecture

## Decision

Build a Tauri 2 application (Rust + a small React UI) for Windows. Do not use Electron. Do not generate labels in the agent.

The agent downloads the PDF that PostBus already stored and submits it through the installed Windows printer driver. `pdf-to-printer` / SumatraPDF is the proven path in `print-agent/index.mjs` and remains the phase-1 renderer. A later Rust spooler integration can replace it after hardware tests.

## Components

```
Orders / Automation UI
        │  merchant session cookie
        ▼
Next.js  lib/api/v1/print.ts
        │  service role stays on the server
        ▼
Supabase  print_agents, print_jobs, print_settings, labels
        ▲
        │  device credential, HTTPS poll
Tauri agent on the packing PC
        │
        ▼
Windows Print Spooler → USB or network printer driver
```

Polling stays. Supabase realtime already publishes `print_jobs` and `print_agents`; the agent can subscribe later. Phase 1 does not depend on a socket staying open through the packing PC firewall.

## Desktop layout

```
print-agent-desktop/
  src/                 React setup and tray status
  src-tauri/
    src/printers/      Win32 printer enumeration
    src/print/         PDF file + Sumatra/driver submit
    src/auth/          Credential Manager
    src/agent/         poll, claim, download, report
    tauri.conf.json
```

The current `print-agent/index.mjs` stays until the EXE replaces it in the dashboard instructions.

## Printer discovery

Rust enumerates printers with the Windows spooler (`EnumPrinters`). Each record:

- stable local id when the spooler provides one, otherwise a hash of the port and name scoped to this device
- display name
- `connection_type`: `USB`, `NETWORK`, or `UNKNOWN`
- `status`: `ready`, `offline`, or `UNKNOWN`
- `is_default` from the Windows default
- `supports_pdf`: `null` (not asserted)

The agent reports this list on heartbeat. PostBus stores names for the picker. It does not invent capabilities.

## Pairing

The agent creates a device keypair or random device secret locally, then asks PostBus for a pairing challenge bound to a hash of that secret. The dashboard redeems the short code with the signed-in merchant. The agent then proves the secret and receives a device credential. The code alone cannot download labels.

`print_agents.organization_id` is unique today. Pairing multiple PCs requires dropping that uniqueness and adding `revoked_at`, `platform`, and `agent_version`. The Node CLI continues to use the existing token rotation endpoint.

## Print path

1. Merchant clicks Direct Print.
2. Server checks `automation.manage` or the operator print permission already used for print jobs, confirms the label belongs to the organization, and inserts `print_jobs` with `source = MANUAL` and delivery `agent`.
3. Agent claims with a conditional update `status = PENDING`.
4. Agent downloads `GET print-jobs/:id/pdf` (already checks `%PDF` on the server).
5. Agent submits to the named printer at actual size (`scale: noscale` today).
6. Agent reports `SUBMITTED_TO_SPOOLER`, not `PRINTED`.
7. If the process dies after submit and before the report, recovery sets `UNKNOWN` instead of `PENDING`.

Bulk selection creates one job per selected label, in selection order. Progress counts queued, submitted, failed, and unknown. It does not count sheets that left the printer.

## What stays untouched

- `modules/labels/**` PDF builders
- India Post booking and tracking
- Shopify order sync
- Billing
- WebUSB `delivery = webusb` jobs, which the agent already skips in `claimNextPrintJob`
- Browser download of the same PDF
