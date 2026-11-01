import { existsSync, readFileSync } from "node:fs";

const path = "coolify.local.json";
if (!existsSync(path)) {
  console.log(JSON.stringify({ ok: false, reason: "coolify.local.json missing" }));
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(path, "utf8")) as {
  baseUrl?: string;
  applicationUuid?: string;
  apiToken?: string;
};
const base = String(cfg.baseUrl || "").replace(/\/$/, "");
const uuid = String(cfg.applicationUuid || "");
const token = String(cfg.apiToken || "");
if (!base || !uuid || !token) {
  console.log(JSON.stringify({ ok: false, reason: "incomplete coolify config" }));
  process.exit(1);
}

const res = await fetch(`${base}/api/v1/applications/${uuid}`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
});
const data = (await res.json()) as Record<string, unknown>;
const settings = (data.settings ?? {}) as Record<string, unknown>;
const fqdn = typeof data.fqdn === "string" ? data.fqdn.split(",")[0]?.replace(/^https?:\/\//, "") : null;

console.log(
  JSON.stringify({
    ok: res.ok,
    http: res.status,
    uuid: data.uuid ?? uuid,
    status: data.status ?? null,
    git_branch: data.git_branch ?? null,
    git_commit_sha: data.git_commit_sha ?? null,
    is_auto_deploy_enabled: settings.is_auto_deploy_enabled ?? null,
    fqdn_host: fqdn,
  })
);
