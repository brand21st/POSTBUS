# PostBus Print Agent — auto updates

The desktop app checks `https://www.postbus.in/api/v1/public/print-agent/updater/...` on launch and every 6 hours.

## One-time: signing key

Keys live in `.tauri/signing.key` (private, never commit) and `.tauri/signing.key.pub`. The public key is already in `src-tauri/tauri.conf.json`.

If you regenerate keys, update `plugins.updater.pubkey` and republish all future updates with the new private key.

## Release a new version

1. Bump `version` in `package.json` and `src-tauri/tauri.conf.json` (and `Cargo.toml` if needed).
2. Build with signing enabled (PowerShell):

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "D:\POST BUS APP\print-agent-desktop\.tauri\signing.key"
cd "D:\POST BUS APP\print-agent-desktop"
npm run tauri build
```

3. Upload `src-tauri/target/release/bundle/nsis/PostBus Print Agent_<version>_x64-setup.exe` to a **public HTTPS** URL (R2, S3, or `/public` on CDN).
4. Print Coolify env vars:

```powershell
$env:PRINT_AGENT_UPDATE_URL = "https://your-cdn/postbus/PostBus Print Agent_0.3.0_x64-setup.exe"
node scripts/print-update-env.mjs
```

5. Set `PRINT_AGENT_UPDATE_VERSION`, `PRINT_AGENT_UPDATE_URL`, `PRINT_AGENT_UPDATE_SIGNATURE`, and optional `PRINT_AGENT_UPDATE_NOTES` on production, then redeploy the web app.

Installed agents with a lower version will see **Update available** and install silently (passive NSIS mode).
