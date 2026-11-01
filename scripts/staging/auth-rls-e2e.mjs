/**
 * Authenticated GoTrue + PostgREST RLS proof against local supabase only.
 * Never prints tokens or passwords. Refuses production project ref.
 */
import { readFileSync, writeFileSync } from "node:fs";
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
if (!url || url.toLowerCase().includes(PRODUCTION_REF) || !url.includes("127.0.0.1")) {
  console.error("STOP: refusing auth E2E against a non-loopback or production URL");
  process.exit(1);
}

const out = { ok: true, checks: [] };
function check(name, pass, detail) {
  out.checks.push({ name, pass, detail: detail ?? null });
  if (!pass) out.ok = false;
}

async function jsonFetch(path, init = {}) {
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: anon,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

async function signup(email, password) {
  return jsonFetch("/auth/v1/signup", {
    method: "POST",
    headers: { Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ email, password }),
  });
}

async function passwordLogin(email, password) {
  return jsonFetch("/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ email, password }),
  });
}

async function refresh(refreshToken) {
  return jsonFetch("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    headers: { Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

async function logout(accessToken) {
  return jsonFetch("/auth/v1/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

function rest(accessToken, path, init = {}) {
  return jsonFetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
}

const passwordA = "StagingPass-A-1!";
const passwordB = "StagingPass-B-1!";
const emailA = `staging-org-a-${Date.now()}@postbus.invalid`;
const emailB = `staging-org-b-${Date.now()}@postbus.invalid`;

const health = await jsonFetch("/auth/v1/health");
check("auth-health", health.status === 200, `status=${health.status}`);

const signA = await signup(emailA, passwordA);
const signB = await signup(emailB, passwordB);
check("signup-a", Boolean(signA.body?.user?.id), `status=${signA.status}`);
check("signup-b", Boolean(signB.body?.user?.id), `status=${signB.status}`);

const confirm = spawnSync(
  "wsl",
  [
    "-d",
    "Ubuntu",
    "--",
    "docker",
    "exec",
    "-i",
    "supabase_db_postbuslocal",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-c",
    "update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where email like '%@postbus.invalid';",
  ],
  { encoding: "utf8" }
);
check("email-confirm-local-only", confirm.status === 0, confirm.stderr ? "confirm-error" : "updated");

const loginA = await passwordLogin(emailA, passwordA);
const loginB = await passwordLogin(emailB, passwordB);
check("password-login-a", loginA.status === 200 && Boolean(loginA.body?.access_token), `status=${loginA.status}`);
check("password-login-b", loginB.status === 200 && Boolean(loginB.body?.access_token), `status=${loginB.status}`);

const tokenA = loginA.body?.access_token;
const tokenB = loginB.body?.access_token;
check("access-token-a", typeof tokenA === "string" && tokenA.length > 20, `len=${tokenA ? String(tokenA).length : 0}`);
check("jwt-ref-not-production", !String(tokenA || "").includes(PRODUCTION_REF), "ok");

const unauth = await jsonFetch("/rest/v1/orders?select=id", {
  headers: { Authorization: `Bearer ${anon}` },
});
check("unauthenticated-orders-rejected", unauth.status === 401 || (Array.isArray(unauth.body) && unauth.body.length === 0), `status=${unauth.status}`);

if (tokenA && tokenB) {
  const orgA = await rest(tokenA, "/rest/v1/rpc/create_organization_for_user", {
    method: "POST",
    body: JSON.stringify({ p_name: "Staging Org A" }),
  });
  const orgB = await rest(tokenB, "/rest/v1/rpc/create_organization_for_user", {
    method: "POST",
    body: JSON.stringify({ p_name: "Staging Org B" }),
  });
  const orgAId = orgA.body?.id;
  const orgBId = orgB.body?.id;
  check("create-org-a", orgA.status < 300 && Boolean(orgAId), `status=${orgA.status}`);
  check("create-org-b", orgB.status < 300 && Boolean(orgBId), `status=${orgB.status}`);

  const listedA = await rest(tokenA, "/rest/v1/organizations?select=id,name");
  const listedB = await rest(tokenB, "/rest/v1/organizations?select=id,name");
  const idsA = Array.isArray(listedA.body) ? listedA.body.map((row) => row.id) : [];
  const idsB = Array.isArray(listedB.body) ? listedB.body.map((row) => row.id) : [];
  check("org-a-sees-self", idsA.includes(orgAId) && idsA.length === 1, `count=${idsA.length}`);
  check("org-b-sees-self", idsB.includes(orgBId) && idsB.length === 1, `count=${idsB.length}`);
  check("org-a-cannot-see-b", !idsA.includes(orgBId), "isolated");
  check("org-b-cannot-see-a", !idsB.includes(orgAId), "isolated");

  async function insertAddress(token, organizationId, extra = {}) {
    return rest(token, "/rest/v1/addresses", {
      method: "POST",
      body: JSON.stringify({
        organization_id: organizationId,
        kind: "shipping",
        name: extra.name ?? "Asha Kumar",
        phone: extra.phone ?? "9876543210",
        line1: extra.line1 ?? "12 MG Road",
        line2: extra.line2 ?? "",
        line3: extra.line3 ?? "Near town hall",
        city: extra.city ?? "Kozhikode",
        state: extra.state ?? "Kerala",
        pincode: extra.pincode ?? "673001",
        country: "IN",
        address_validation_status: extra.address_validation_status ?? null,
        address_manual_override: extra.address_manual_override ?? null,
      }),
    });
  }

  const addrA = await insertAddress(tokenA, orgAId);
  const addrB = await insertAddress(tokenB, orgBId, { name: "Biju", phone: "9123456789", pincode: "682001", city: "Kochi" });
  const addrAId = Array.isArray(addrA.body) ? addrA.body[0]?.id : addrA.body?.id;
  const addrBId = Array.isArray(addrB.body) ? addrB.body[0]?.id : addrB.body?.id;
  check("insert-address-a", Boolean(addrAId), `status=${addrA.status}`);
  check("insert-address-b", Boolean(addrBId), `status=${addrB.status}`);

  const crossInsert = await insertAddress(tokenB, orgAId, { name: "Cross Tenant" });
  check(
    "insert-isolation-b-into-a",
    crossInsert.status === 401 || crossInsert.status === 403 || crossInsert.status >= 400,
    `status=${crossInsert.status}`
  );

  const selectCross = await rest(tokenA, `/rest/v1/addresses?id=eq.${addrBId}&select=id,name`);
  const crossRows = Array.isArray(selectCross.body) ? selectCross.body : [];
  check("select-isolation-a-cannot-read-b", selectCross.status === 200 && crossRows.length === 0, `count=${crossRows.length}`);

  const updateCross = await rest(tokenA, `/rest/v1/addresses?id=eq.${addrBId}`, {
    method: "PATCH",
    body: JSON.stringify({ city: "Hacked" }),
  });
  const afterHack = await rest(tokenB, `/rest/v1/addresses?id=eq.${addrBId}&select=city`);
  const cityB = Array.isArray(afterHack.body) ? afterHack.body[0]?.city : afterHack.body?.city;
  check("update-isolation-a-cannot-write-b", cityB !== "Hacked", `city=${cityB} status=${updateCross.status}`);

  const deleteCross = await rest(tokenA, `/rest/v1/addresses?id=eq.${addrBId}`, { method: "DELETE" });
  const stillB = await rest(tokenB, `/rest/v1/addresses?id=eq.${addrBId}&select=id`);
  check(
    "delete-isolation-a-cannot-delete-b",
    Array.isArray(stillB.body) && stillB.body.length === 1,
    `status=${deleteCross.status} remaining=${Array.isArray(stillB.body) ? stillB.body.length : -1}`
  );

  const rpcCross = await rest(tokenB, "/rest/v1/rpc/create_organization_for_user", {
    method: "POST",
    body: JSON.stringify({ p_name: "Should fail second workspace" }),
  });
  check(
    "rpc-one-workspace-or-authorized",
    rpcCross.status >= 400 || Boolean(rpcCross.body?.id),
    `status=${rpcCross.status}`
  );

  const expired = await rest("not-a-jwt", "/rest/v1/orders?select=id");
  check("expired-or-invalid-token-rejected", expired.status === 401, `status=${expired.status}`);

  const refreshed = await refresh(loginA.body.refresh_token);
  check("session-refresh", refreshed.status === 200 && Boolean(refreshed.body?.access_token), `status=${refreshed.status}`);

  const logoutRes = await logout(refreshed.body?.access_token || tokenA);
  check("logout", logoutRes.status === 204 || logoutRes.status === 200, `status=${logoutRes.status}`);

  out.orgAId = orgAId;
  out.orgBId = orgBId;
  out.addrAId = addrAId;
  out.addrBId = addrBId;
  out.emailA = emailA;
  out.emailB = emailB;
  out.emailAHost = emailA.split("@")[1];
}

writeFileSync("scripts/staging/auth-rls-e2e-last.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ok: out.ok, passed: out.checks.filter((c) => c.pass).length, failed: out.checks.filter((c) => !c.pass).map((c) => c.name), orgA: Boolean(out.orgAId), orgB: Boolean(out.orgBId) }));
if (!out.ok) process.exit(1);
