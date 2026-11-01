/**
 * Create two synthetic users on local GoTrue. Does not print passwords.
 */
import { readFileSync } from "node:fs";

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
  console.error("STOP: refusing signup; URL is missing or production");
  process.exit(1);
}

async function signup(email, password) {
  const res = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return {
    status: res.status,
    hasUser: Boolean(body.user?.id),
    hasSession: Boolean(body.session?.access_token),
    error: body.error_description || body.msg || body.error || null,
  };
}

const a = await signup("staging-org-a@postbus.invalid", "StagingPass-A-1!");
const b = await signup("staging-org-b@postbus.invalid", "StagingPass-B-1!");
console.log(JSON.stringify({ urlHost: new URL(url).host, userA: a, userB: b }));
if (!a.hasUser || !b.hasUser) process.exit(1);
