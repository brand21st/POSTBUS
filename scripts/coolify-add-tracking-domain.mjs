#!/usr/bin/env node
/**
 * Add a merchant tracking subdomain to the PostBus Coolify app.
 *
 * Usage:
 *   node scripts/coolify-add-tracking-domain.mjs saneesh-e
 *   node scripts/coolify-add-tracking-domain.mjs priya-stores --restart
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const configPath = resolve(ROOT, "coolify.local.json");

function loadConfig() {
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    console.error(`Missing ${configPath}. Copy infra/coolify.example.json and add your API token.`);
    process.exit(1);
  }
}

async function api(config, method, path, body) {
  const response = await fetch(`${config.baseUrl}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || `${response.status} ${text}`);
  }
  return data;
}

function parseDomains(fqdn) {
  return fqdn
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function trackingDomain(subdomain) {
  const label = subdomain.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$/.test(label)) {
    throw new Error(`Invalid subdomain: ${subdomain}`);
  }
  return `https://${label}.postbus.in`;
}

async function main() {
  const subdomain = process.argv[2];
  const shouldRestart = process.argv.includes("--restart");
  if (!subdomain) {
    console.error("Usage: node scripts/coolify-add-tracking-domain.mjs <subdomain> [--restart]");
    process.exit(1);
  }

  const config = loadConfig();
  const app = await api(config, "GET", `/applications/${config.applicationUuid}`);
  const domains = parseDomains(app.fqdn ?? "");
  const next = trackingDomain(subdomain);

  if (domains.includes(next)) {
    console.log(`Already configured: ${next}`);
    return;
  }

  domains.push(next);
  await api(config, "PATCH", `/applications/${config.applicationUuid}`, {
    domains: domains.join(","),
    instant_deploy: false,
  });
  console.log(`Added ${next}`);

  if (shouldRestart) {
    await api(config, "POST", `/applications/${config.applicationUuid}/restart`);
    console.log("Restart queued.");
  } else {
    console.log("Run with --restart to apply routing immediately.");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
