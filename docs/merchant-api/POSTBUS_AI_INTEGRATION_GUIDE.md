# Using ChatGPT, Gemini, Claude, or Cursor with PostBus

PostBus does not run an AI model for integrations. You copy documentation into the assistant you already use.

## Steps

1. Open **Dashboard → Integrations → Developer API**.
2. Create a scoped API key. Copy the secret once into Google Apps Script **Project Settings → Script properties** (`POSTBUS_API_KEY`). Never paste the key into ChatGPT.
3. Download `openapi.yaml` and `POSTBUS_API_REFERENCE.md`.
4. Copy **Build your integration with AI** prompt from the Developer Portal.
5. In ChatGPT or Gemini, attach the docs and paste the prompt.
6. Describe your actual sheet headers. Ask the model to map those headers to the documented JSON fields.
7. Review the script: it must call only `/api/merchant/v1`, use `Idempotency-Key`, store `external_order_id`, and keep create vs book as separate functions.

## Rules to give the model

- Do not invent endpoints or fields.
- Do not auto-book on create.
- Do not use sheet row numbers as the only identity after sorting.
- Treat `QUEUED` / `BOOKING` as requested, not delivered.
- On HTTP 429, honor `Retry-After`.
- Never log the bearer token.
