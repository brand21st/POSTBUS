# PostBus Print Agent — product requirements

## Outcome

A merchant installs PostBus Print Agent once, pairs it once from the dashboard, chooses a default Windows printer once, and then prints an existing shipping-label PDF from Orders without a browser print dialog or a manual download.

## Users

Packing staff on Windows 10 or Windows 11 who already book India Post shipments in PostBus. They may use a thermal label printer or an A4 printer that Windows already has a driver for.

## In scope

- Windows EXE installer and system tray
- Printer list from the Windows spooler
- Short-lived pairing code entered in the dashboard
- Persistent device credential in Windows Credential Manager
- Direct print of one label and of the orders the merchant actually selected
- Test print
- Job history with honest statuses
- Disconnect / revoke device
- Existing browser printing when no agent is online

## Out of scope for phase 1

- macOS
- Raw USB or ZPL/TSPL as the primary path (WebUSB already covers thermal protocols in the browser)
- A new label layout engine
- Automatic booking
- Automatic printing unless the existing Auto Label Printing switch is on
- Claiming a physical printout when Windows only accepted the job

## Experience

1. Download the Windows installer from Settings → Printing.
2. Install and open PostBus Print Agent.
3. The agent lists installed printers and shows a pairing code.
4. An OWNER, ADMIN, or MANAGER enters the code in the dashboard.
5. The agent stores a device credential and reconnects on its own.
6. The merchant picks a default printer and runs a test print.
7. On an order with a ready label, **Direct Print** sends that PDF to the agent. **Browser Print** remains available.
8. Bulk print uses the current selection only.

## Rules

- A USB device that Windows has not installed a driver for is not a printer the agent can use. The UI says so.
- Printer status from Windows is not proof that paper or ribbon is loaded.
- If the agent submitted a job and then crashed before reporting it, the job becomes `UNKNOWN`. It is not printed again until a person chooses reprint.
- Pairing codes expire, are single-use, and are not themselves the device credential.
