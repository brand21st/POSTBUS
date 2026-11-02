import { createDecipheriv, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const supabaseUrl = process.env.PB_SUPABASE_URL.replace(/\/$/, "");
const service = process.env.PB_SERVICE_ROLE;
const encKey = process.env.PB_ENC_KEY;
const mcpPath = process.env.MCP_PATH;

function decrypt(payload) {
  if (!payload) return "";
  const [iv, tag, data] = payload.split(".");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    scryptSync(encKey, "postbus-integrations", 32),
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

const rows = await (
  await fetch(`${supabaseUrl}/rest/v1/platform_settings?id=eq.1&select=razorpay_key_id,encrypted_razorpay_key_secret`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` },
  })
).json();

const keyId = (rows[0].razorpay_key_id || "").trim();
const secret = decrypt(rows[0].encrypted_razorpay_key_secret).trim();
if (!keyId || !secret) throw new Error("missing keys");

const token = Buffer.from(`${keyId}:${secret}`).toString("base64");
const mcp = { mcpServers: {} };
try {
  Object.assign(mcp, JSON.parse(readFileSync(mcpPath, "utf8")));
} catch {
  mcp.mcpServers = mcp.mcpServers || {};
}
if (!mcp.mcpServers) mcp.mcpServers = {};
mcp.mcpServers["rzp-mcp-server"] = {
  command: "npx",
  args: ["-y", "mcp-remote", "https://mcp.razorpay.com/mcp", "--header", "Authorization:${AUTH_HEADER}"],
  env: { AUTH_HEADER: `Basic ${token}` },
};
writeFileSync(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`);
console.log(
  JSON.stringify({
    wrote: true,
    keyIdPrefix: keyId.slice(0, 8),
    mode: keyId.startsWith("rzp_live") ? "live" : "test",
  })
);
