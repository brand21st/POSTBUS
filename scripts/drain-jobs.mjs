// Scheduled entrypoint for the database-backed job runner.
// Coolify scheduled task: `node scripts/drain-jobs.mjs` on `* * * * *`.

const port = process.env.PORT || "3000";
const base = process.env.JOB_RUNNER_URL || `http://127.0.0.1:${port}`;
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("CRON_SECRET is not set.");
  process.exit(1);
}

const response = await fetch(`${base}/api/cron/jobs`, {
  method: "POST",
  headers: { authorization: `Bearer ${secret}` },
});

const body = await response.text();
console.log(`${response.status} ${body}`);

if (!response.ok) {
  process.exit(1);
}
