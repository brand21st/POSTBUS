// Coolify scheduled entrypoint for billing status reconciliation.
// Command: node scripts/billing-cron.mjs
// Frequency: */5 * * * *
// Reads CRON_SECRET from the container environment. Do not put the secret in the task command.

const port = String(process.env.PORT || "3000").trim();
if (!/^\d+$/.test(port)) {
  console.error("PORT is invalid.");
  process.exit(1);
}

const base = process.env.JOB_RUNNER_URL || `http://127.0.0.1:${port}`;
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("CRON_SECRET is not set.");
  process.exit(1);
}

const timeoutMs = Number(process.env.BILLING_CRON_TIMEOUT_MS || "25000");
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 25000);

let response;
try {
  response = await fetch(`${base}/api/cron/billing`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: controller.signal,
  });
} catch (error) {
  clearTimeout(timer);
  const message = error instanceof Error ? error.message : "unknown";
  const timedOut = error instanceof Error && error.name === "AbortError";
  console.error(timedOut ? "billing cron request timed out" : `billing cron request failed: ${message}`);
  process.exit(1);
}
clearTimeout(timer);

let parsed = null;
try {
  parsed = JSON.parse(await response.text());
} catch {
  parsed = null;
}

const success = Boolean(parsed && parsed.success === true);
console.log(
  JSON.stringify({
    event: "billing.cron_script",
    status: response.status,
    success,
    expired: parsed?.data?.expired ?? null,
    skipped: parsed?.data?.skipped ?? null,
    failures: parsed?.data?.failures ?? null,
  })
);

if (!response.ok || !success) {
  process.exit(1);
}
