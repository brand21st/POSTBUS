import { readFileSync, existsSync } from "fs";

function load(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

load(".env.local");
load(".env");

const base = (process.env.COOLIFY_BASE_URL || "").replace(/\/$/, "");
const token = process.env.COOLIFY_API_TOKEN || "";
const uuid = process.env.COOLIFY_APPLICATION_UUID || "mw9larpomkyonxzy1rk3h6jm";
const report = {
  hasBase: Boolean(base),
  hasToken: Boolean(token),
  uuid,
  reachable: false,
  httpStatus: null,
  commit: null,
  status: null,
  gitBranch: null,
  error: null,
};

if (!base || !token) {
  console.log(JSON.stringify(report));
  process.exit(0);
}

const url = base.includes("host.docker.internal")
  ? base.replace("http://host.docker.internal:8000", "http://127.0.0.1:8000")
  : base;

try {
  const res = await fetch(`${url}/api/v1/applications/${uuid}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  report.reachable = true;
  report.httpStatus = res.status;
  if (!res.ok) {
    report.error = `http_${res.status}`;
    console.log(JSON.stringify(report));
    process.exit(0);
  }
  const data = await res.json();
  report.status = data.status ?? null;
  report.gitBranch = data.git_branch ?? data.branch ?? null;
  report.commit =
    data.commit ?? data.git_commit_sha ?? data.deployment?.commit ?? data.last_online_at ?? null;
  report.keys = Object.keys(data);
} catch (error) {
  report.error = error instanceof Error ? error.name : "fetch_failed";
}

console.log(JSON.stringify(report));
