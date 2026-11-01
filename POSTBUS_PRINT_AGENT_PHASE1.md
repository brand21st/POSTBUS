# PostBus Print Agent — Phase 1

Date: 15 October 2026

Phase 1 is a local Windows desktop app. It does not pair with PostBus, call the API, or change production print jobs. The Node agent in `print-agent/` is still the production agent.

## What shipped

- Tauri 2 application in `print-agent-desktop/`, product name PostBus Print Agent, identifier `in.postbus.print-agent`.
- Installed printers come from `EnumPrinters` (local queues and connections).
- A queue is labeled USB only when its port name contains `USB`. Network is used for `IP_`, UNC, WSD, TCP, and HTTP ports. Anything else stays UNKNOWN.
- Spooler status `0` is shown as ready. Offline and Work Offline are shown as offline. Any other status bit stays UNKNOWN. PDF support is not guessed.
- The selected printer is stored in the app data `settings.json`. That file is not a credential.
- Test print writes a local 4×6 inch PDF, renders it with Windows `Windows.Data.Pdf`, and draws the page through the selected printer device context (`CreateDC` / `StartDoc`). The printer name is passed as a UTF-16 argument to the spooler, not interpolated into a shell command.
- Closing the window hides it. The tray menu can open the window again or quit.
- NSIS installer, current user, unsigned.

## Verification on this PC

Installed queues: Microsoft Print to PDF, OneNote (Desktop), RustDesk Printer. None of those ports say USB, so the list shows UNKNOWN. Unit tests cover USB and network port names.

Printing the test page to Microsoft Print to PDF from the release app produced a PDF from that driver and the app reported the handoff. The generated file was removed after the check. No USB label printer was attached, so a physical label was not checked.

Closing the window left the process running. Quit was not left running.

The release executable does not contain `pb_print_`, a service-role key, or a live secret prefix.

## Installer

`print-agent-desktop/src-tauri/target/release/bundle/nsis/PostBus Print Agent_0.1.0_x64-setup.exe`

About 2.0 MB. Built with `npm run tauri build`. The executable beside it is `src-tauri/target/release/postbus-print-agent.exe`. WebView2 must already be present on the PC. The installer is not code-signed.

## Tests

`cargo test` in `print-agent-desktop/src-tauri`: 7 passed. They cover port classification, status bits, empty printer names, the PDF header, and a live `EnumPrinters` call.

## Known limitations

- USB is inferred from the port name. A USB printer with a port that does not contain `USB` stays UNKNOWN.
- This build does not talk to PostBus. It cannot claim jobs, download labels, or turn on automatic printing.
- Spooler acceptance is not proof that paper came out.
- Microsoft Print to PDF asks for a file name through that driver. Other drivers print to their own device.
- The tray icon uses the application icon. There is no separate status icon for errors.
- The installer is unsigned, so Windows SmartScreen can warn before launch.

## Not started

Device pairing, database migrations, print-job status changes, India Post, Shopify, billing, and production deploy. Those stay behind a separate approval.
