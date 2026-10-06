// Scheduled entrypoint for the database-backed job runner.
// Coolify: three tasks on the same web container, `* * * * *`:
//   JOB_TYPES=shipment-booking node scripts/drain-jobs.mjs
//   JOB_TYPES=label-generation node scripts/drain-jobs.mjs
//   JOB_TYPES=invoice-generation,... node scripts/drain-jobs.mjs

const port = process.env.PORT || "3000";
const base = process.env.JOB_RUNNER_URL || `http://127.0.0.1:${port}`;
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("CRON_SECRET is not set.");
  process.exit(1);
}

const params = new URLSearchParams();
if (process.env.JOB_TYPES?.trim()) {
  params.set("types", process.env.JOB_TYPES.trim());
}
const query = params.toString();
const response = await fetch(`${base}/api/cron/jobs${query ? `?${query}` : ""}`, {
  method: "POST",
  headers: { authorization: `Bearer ${secret}` },
});

const body = await response.text();
console.log(`${response.status} ${body}`);

if (!response.ok) {
  process.exit(1);
}
