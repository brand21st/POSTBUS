# PostBus Print Agent (Phase 1)

Windows desktop app for listing installed printers and sending a local test PDF to a Windows printer driver.

This build does not sign in, pair with PostBus, or upload documents. The Node agent in `../print-agent` is unchanged.

## Develop

Install Rust, then from this folder:

```bash
npm install
npm run tauri dev
```

## Installer

```bash
npm run tauri build
```

The NSIS installer is written under `src-tauri/target/release/bundle/nsis/`. The build is unsigned unless a certificate is configured outside this repository.

## Printing

Test pages are 4×6 inch PDFs. Windows renders the page and draws it through the selected printer's device context, so the installed driver receives the job. A printer is labeled USB only when its port name contains `USB`.
