# PostBus print agent

The PostBus VPS cannot see a printer plugged into a packing computer. This agent runs **on that computer**, lists local printers, and prints label PDFs after they are saved.

## Setup (Windows packing PC)

1. Install Node.js 20+.
2. In the PostBus dashboard open **Automation → Auto Label Printing → Connect Printer**.
3. Copy the token (shown once).
4. In this folder:

```bash
npm install
node index.mjs --url https://your-postbus-domain --token pb_print_...
```

5. Keep the process running while you pack. Back on the dashboard, pick the **label** printer (not the office laser) and turn Auto Label Printing on.

Pending jobs print when the agent reconnects. The same automatically generated label is not printed twice.

## Notes

- Paper size defaults to A6, one copy. The India Post PDF is not modified.
- `pdf-to-printer` (SumatraPDF on Windows) is used for silent printing when available.
