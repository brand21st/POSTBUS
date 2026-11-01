/**
 * Confirm synthetic local users, password-grant login, probe RLS.
 * Local GoTrue only. Does not print tokens.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PRODUCTION_REF = "hgacoeoovjxkzfbesmvl";
const env = Object.fromEntries(
  readFileSync(".env.staging.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || url.toLowerCase().includes(PRODUCTION_REF)) {
  console.error("STOP: refusing login against production");
  process.exit(1);
}

const sql = "update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where email like '%@postbus.invalid';";
const confirm = spawnSync(
  "wsl",
  ["-d", "Ubuntu", "--", "docker", "exec", "-i", "supabase_db_postbuslocal", "psql", "-U", "postgres", "-d", "postgres", "-c", sql],
  { encoding: "utf8" }
);
if (confirm.status !== 0) {
  console.error("STOP: local confirm failed", confirm.stderr || confirm.stdout);
  process.exit(1);
}

async function login(email, password) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  const token = body.access_token;
  let orgsStatus = null;
  let orgCount = null;
  if (token) {
    const orgs = await fetch(`${url}/rest/v1/organizations?select=id`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
    });
    orgsStatus = orgs.status;
    const rows = await orgs.json().catch(() => []);
    orgCount = Array.isArray(rows) ? rows.length : -1;
  }
  return {
    status: res.status,
    hasSession: Boolean(token),
    tokenLen: token ? String(token).length : 0,
    orgsStatus,
    orgCount,
    error: body.error_description || body.error || null,
  };
}

const a = await login("staging-org-a@postbus.invalid", "StagingPass-A-1!");
const b = await login("staging-org-b@postbus.invalid", "StagingPass-B-1!");
console.log(JSON.stringify({ urlHost: new URL(url).host, userA: a, userB: b }));
if (!a.hasSession || !b.hasSession) process.exit(1);
