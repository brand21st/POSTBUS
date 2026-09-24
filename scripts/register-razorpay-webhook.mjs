import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const appUrl = process.env.PB_APP_URL.replace(/\/$/, "");
const supabaseUrl = process.env.PB_SUPABASE_URL.replace(/\/$/, "");
const service = process.env.PB_SERVICE_ROLE;
const encKey = process.env.PB_ENC_KEY;
const webhookUrl = `${appUrl}/api/webhooks/razorpay`;

const subscriptionEvents = [
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
  "subscription.updated",
  "subscription.pending",
  "subscription.halted",
  "subscription.cancelled",
  "subscription.paused",
  "subscription.resumed",
  "subscription.completed",
];
const paymentEvents = ["payment.captured", "payment.failed", "invoice.paid", "refund.processed"];
const allEvents = [...subscriptionEvents, ...paymentEvents];
function asEventMap(names) {
  return Object.fromEntries(names.map((name) => [name, true]));
}

function keyBytes() {
  return scryptSync(encKey, "postbus-integrations", 32);
}

function decryptSecret(payload) {
  if (!payload) return "";
  const [iv, tag, data] = payload.split(".");
  if (!iv || !tag || !data) throw new Error("Invalid encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

function encryptSecret(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

async function sb(path, init = {}) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function rzp(keyId, secret, method, path, body) {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const desc = json.error?.description || JSON.stringify(json).slice(0, 200);
    throw new Error(`razorpay ${method} ${path} ${res.status} ${desc}`);
  }
  return json;
}

const rows = await sb(
  "platform_settings?id=eq.1&select=razorpay_key_id,encrypted_razorpay_key_secret,encrypted_razorpay_webhook_secret,razorpay_webhook_id"
);
const row = rows[0];
if (!row) throw new Error("platform_settings missing");

const keyId = (row.razorpay_key_id || "").trim();
let keySecret = "";
try {
  keySecret = decryptSecret(row.encrypted_razorpay_key_secret);
} catch (error) {
  console.log("KEY_SECRET_DECRYPT_FAIL", error.message);
}
let webhookSecret = "";
try {
  webhookSecret = decryptSecret(row.encrypted_razorpay_webhook_secret);
} catch (error) {
  console.log("WEBHOOK_SECRET_DECRYPT_FAIL", error.message);
}

console.log(
  JSON.stringify({
    keyIdPrefix: keyId.slice(0, 8),
    keyIdLen: keyId.length,
    hasKeySecret: Boolean(keySecret),
    hasWebhookSecret: Boolean(webhookSecret),
    existingWebhookId: row.razorpay_webhook_id || null,
    webhookUrl,
  })
);

if (!keyId || !keySecret) {
  throw new Error("Razorpay API keys not decryptable with production encryption key");
}

const ping = await rzp(keyId, keySecret, "GET", "/customers?count=1");
console.log(`API_OK customers_sample=${ping.count ?? 0}`);

if (!webhookSecret) {
  webhookSecret = randomBytes(20).toString("hex");
  console.log("GENERATED_WEBHOOK_SECRET=true");
} else {
  console.log("GENERATED_WEBHOOK_SECRET=false");
}

const listed = await rzp(keyId, keySecret, "GET", "/webhooks");
const items = listed.items || [];
console.log(
  "EXISTING_WEBHOOKS",
  items.map((item) => ({ id: item.id, url: item.url, active: item.active })).slice(0, 10)
);

let webhookId = row.razorpay_webhook_id || "";
const sameUrl = items.find((item) => String(item.url || "") === webhookUrl);
let usedEvents = allEvents;
const payloadFor = (eventNames) => ({ url: webhookUrl, secret: webhookSecret, events: asEventMap(eventNames) });

async function createOrUpdate(eventNames) {
  const payload = payloadFor(eventNames);
  if (webhookId) {
    try {
      await rzp(keyId, keySecret, "PUT", `/webhooks/${webhookId}`, payload);
      console.log("UPDATED_EXISTING_ID", webhookId);
      return webhookId;
    } catch (error) {
      console.log("UPDATE_ID_FAILED", error.message);
      webhookId = "";
    }
  }
  if (sameUrl?.id) {
    await rzp(keyId, keySecret, "PUT", `/webhooks/${sameUrl.id}`, payload);
    console.log("UPDATED_BY_URL", sameUrl.id);
    return String(sameUrl.id);
  }
  const created = await rzp(keyId, keySecret, "POST", "/webhooks", payload);
  console.log("CREATED_WEBHOOK", created.id);
  return String(created.id || "");
}

try {
  webhookId = await createOrUpdate(allEvents);
  usedEvents = allEvents;
} catch (error) {
  console.log("FULL_EVENT_SET_FAILED", error.message);
  usedEvents = paymentEvents;
  webhookId = "";
  webhookId = await createOrUpdate(paymentEvents);
  try {
    await rzp(keyId, keySecret, "PUT", `/webhooks/${webhookId}`, payloadFor(allEvents));
    usedEvents = allEvents;
    console.log("ADDED_SUBSCRIPTION_EVENTS=true");
  } catch (updateError) {
    console.log("SUBSCRIPTION_EVENTS_UNSUPPORTED", updateError.message);
  }
}
console.log("EVENTS_REGISTERED", usedEvents.join(","));

if (!webhookId) throw new Error("No webhook id returned");

await sb("platform_settings?id=eq.1", {
  method: "PATCH",
  body: JSON.stringify({
    razorpay_webhook_id: webhookId,
    encrypted_razorpay_webhook_secret: encryptSecret(webhookSecret),
  }),
});

const verify = await rzp(keyId, keySecret, "GET", `/webhooks/${webhookId}`);
console.log(
  JSON.stringify({
    saved: true,
    webhookId,
    url: verify.url,
    active: verify.active,
    eventCount: Array.isArray(verify.events) ? verify.events.length : Object.keys(verify.events || {}).length,
    events: verify.events,
  })
);
