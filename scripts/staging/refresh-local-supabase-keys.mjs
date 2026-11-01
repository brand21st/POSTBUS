/**
 * Copy local Docker Kong JWT keys into .env.staging.local.
 * Does not print secret values. Refuses production project ref.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const PRODUCTION_REF = "hgacoeoovjxkzfbesmvl";
const result = spawnSync(
  "wsl",
  ["-e", "bash", "-lc", "docker exec supabase_kong_postbuslocal printenv"],
  { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 }
);
if (result.status !== 0) {
  console.error("STOP: could not read Kong env");
  process.exit(1);
}
const env = Object.fromEntries(
  result.stdout
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    })
);
const anon = env.SUPABASE_ANON_KEY || env.ANON_KEY || "";
const service = env.SUPABASE_SERVICE_KEY || env.SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!anon || !service) {
  console.error("STOP: Kong env missing JWT keys", Object.keys(env).filter((k) => /KEY|JWT|ANON|SERVICE/i.test(k)));
  process.exit(1);
}
const blob = `${anon} ${service}`.toLowerCase();
if (blob.includes(PRODUCTION_REF)) {
  console.error("STOP: production ref in Kong keys");
  process.exit(1);
}
function jwtRole(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).role;
  } catch {
    return "";
  }
}
mkdirSync(".staging", { recursive: true });
writeFileSync(
  ".staging/supabase-local.env",
  `API_URL=http://127.0.0.1:54321\nANON_KEY=${anon}\nSERVICE_ROLE_KEY=${service}\n`
);
let text = readFileSync(".env.staging.local", "utf8");
function set(key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) text = text.replace(re, `${key}=${value}`);
  else text += `\n${key}=${value}\n`;
}
set("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
set("NEXT_PUBLIC_SUPABASE_ANON_KEY", anon);
set("SUPABASE_SERVICE_ROLE_KEY", service);
writeFileSync(".env.staging.local", text);
console.log(
  JSON.stringify({
    ok: true,
    anonRole: jwtRole(anon),
    serviceRole: jwtRole(service),
    anonLen: anon.length,
    serviceLen: service.length,
    productionRef: false,
  })
);
