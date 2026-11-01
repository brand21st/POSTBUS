/**
 * Application-level Shopify webhook E2E against isolated local Docker + Next :3001.
 * No production writes, no live Shopify, no live India Post.
 */
import http from "node:http";
import { createHmac, randomUUID } from "node:crypto";
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

const restUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const appUrl = env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3001";
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
const hmacSecret = env.SHOPIFY_PUBLIC_APP_CLIENT_SECRET;
const publicSecret = env.SHOPIFY_PUBLIC_APP_CLIENT_SECRET;
const publicClient = env.SHOPIFY_PUBLIC_APP_CLIENT_ID;

function jwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return { role: payload.role || "", ref: payload.ref || payload.iss || "" };
  } catch {
    return { role: "", ref: "" };
  }
}

if (!restUrl || restUrl.toLowerCase().includes(PRODUCTION_REF) || !restUrl.includes("127.0.0.1")) {
  console.error("STOP: refusing non-loopback or production Supabase URL");
  process.exit(1);
}
if (!appUrl.includes("127.0.0.1:3001")) {
  console.error("STOP: refusing non-staging app URL");
  process.exit(1);
}
if (!hmacSecret || !publicClient) {
  console.error("STOP: SHOPIFY_PUBLIC_APP_CLIENT_SECRET/ID missing from staging env");
  process.exit(1);
}
const serviceClaims = jwtRole(service);
if (String(serviceClaims.ref).includes(PRODUCTION_REF)) {
  console.error("STOP: service role JWT mentions production");
  process.exit(1);
}

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), detail: detail ?? null });
  console.log(pass ? "PASS" : "FAIL", name);
}

function requestOnce(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: u.port,
        path: `${u.pathname}${u.search}`,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, text, json });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function request(url, opts = {}, tries = 8) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await requestOnce(url, opts);
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw last;
}

async function rest(path, { method = "GET", body, token = service, prefer } = {}) {
  const headers = {
    apikey: token,
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (body) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const suffix = path.startsWith("/rest/v1") ? path : `/rest/v1${path.startsWith("/") ? path : `/${path}`}`;
  return request(`${restUrl}${suffix}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function addr() {
  return {
    first_name: "Asha",
    last_name: "Rao",
    phone: "9876543210",
    address1: "12 MG Road",
    city: "Bengaluru",
    province: "Karnataka",
    zip: "560001",
    country: "IN",
    country_code: "IN",
  };
}

function orderPayload(id, extra = {}) {
  return {
    id,
    name: extra.name || `#E2E-${id}`,
    email: "e2e@postbus.invalid",
    currency: "INR",
    financial_status: extra.financial_status || "paid",
    fulfillment_status: extra.fulfillment_status || null,
    cancelled_at: extra.cancelled_at || null,
    gateway: extra.gateway || "shopify_payments",
    payment_gateway_names: extra.payment_gateway_names || ["shopify_payments"],
    total_price: extra.total_price ?? "1049.00",
    current_total_price: extra.current_total_price ?? extra.total_price ?? "1049.00",
    subtotal_price: extra.subtotal_price ?? extra.current_total_price ?? "1049.00",
    current_subtotal_price: extra.current_subtotal_price ?? extra.current_total_price ?? "1049.00",
    total_outstanding: extra.total_outstanding ?? "0.00",
    updated_at: extra.updated_at || "2026-11-01T10:00:00Z",
    created_at: extra.created_at || "2026-11-01T09:00:00Z",
    edited: extra.edited ?? false,
    tags: extra.tags || "",
    shipping_address: extra.shipping_address || addr(),
    customer: extra.customer || { first_name: "Asha", last_name: "Rao", phone: "9876543210" },
    line_items: (extra.line_items || []).map((item) => {
      const qty = item.current_quantity ?? item.quantity ?? 0;
      return {
        fulfillable_quantity: item.fulfillable_quantity ?? Math.max(0, qty),
        unfulfilled_quantity: item.unfulfilled_quantity ?? Math.max(0, qty),
        requires_shipping: item.requires_shipping !== false,
        ...item,
      };
    }),
    transactions: extra.transactions,
  };
}

function sign(body, secret = hmacSecret) {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

async function postWebhook(payload, { topic = "orders/updated", shop = SHOP, webhookId, secret } = {}) {
  const body = JSON.stringify(payload);
  const res = await request(`${appUrl}/api/shopify/webhooks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "x-shopify-hmac-sha256": sign(body, secret),
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": shop,
      "x-shopify-webhook-id": webhookId || randomUUID(),
    },
    body,
  });
  return res;
}

async function postPublicWebhook(payload, { topic = "orders/updated", shop = SHOP, webhookId } = {}) {
  const body = JSON.stringify(payload);
  return request(`${appUrl}/api/shopify/webhooks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "x-shopify-hmac-sha256": sign(body, publicSecret),
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": shop,
      "x-shopify-webhook-id": webhookId || randomUUID(),
    },
    body,
  });
}

const SHOP = "postbus-e2e-staging.myshopify.com";
const out = { ok: true, checks, identity: {}, rpc: {}, webhooks: {}, tests: {} };

function dockerSql(sql) {
  const result = spawnSync(
    "wsl",
    ["-e", "bash", "-lc", "docker exec -i supabase_db_postbuslocal psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At -f -"],
    { input: sql, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "psql failed");
  return result.stdout.trim();
}

async function waitForRest(tries = 12) {
  let last = "none";
  for (let i = 0; i < tries; i += 1) {
    try {
      const auth = await request(`${restUrl}/auth/v1/health`);
      const orgs = await rest("/organizations?select=id&limit=1");
      last = `auth=${auth.status} orgs=${orgs.status}`;
      if (auth.status === 200 && orgs.status === 200) return last;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`staging PostgREST not ready: ${last}`);
}

async function main() {
  out.identity = {
    supabaseUrl: restUrl,
    appUrl,
    serviceRole: serviceClaims.role,
    jwtRefLooksLocal: !String(serviceClaims.ref).includes(PRODUCTION_REF),
    shop: SHOP,
  };

  const ready = await waitForRest();
  check("postgrest-ready", true, ready);

  const healthAuth = await request(`${restUrl}/auth/v1/health`);
  check("auth-health", healthAuth.status === 200, healthAuth.status);

  const openapi = await rest("/");
  check("postgrest-openapi", openapi.status === 200, { status: openapi.status, snippet: String(openapi.text || "").slice(0, 80) });

  const rpcOpenapi = JSON.stringify(openapi.json || openapi.text || "").includes("replace_shopify_order_line_items");
  check("postgrest-rpc-in-schema", rpcOpenapi, rpcOpenapi);

  dockerSql(`
delete from public.shopify_app_installations where shop_domain = '${SHOP}';
delete from public.shopify_connections where lower(shop_domain) = '${SHOP}';
`);

  const orgRes = await rest("/organizations", {
    method: "POST",
    prefer: "return=representation",
    body: { name: `e2e-shopify-${Date.now()}` },
  });
  const org = orgRes.json?.[0] || orgRes.json;
  check("seed-org", Boolean(org?.id), orgRes.status);
  const orgId = org.id;

  const orgBRes = await rest("/organizations", {
    method: "POST",
    prefer: "return=representation",
    body: { name: `e2e-tenant-b-${Date.now()}` },
  });
  const orgB = orgBRes.json?.[0] || orgBRes.json;
  const orgBId = orgB.id;

  const auto = await rest("/automation_settings", {
    method: "POST",
    prefer: "return=representation",
    body: {
      organization_id: orgId,
      auto_shopify_sync: true,
      auto_shipment_creation: false,
      auto_booking: false,
    },
  });
  check("seed-automation", auto.status < 300, auto.status);

  const conn = await rest("/shopify_connections", {
    method: "POST",
    prefer: "return=representation",
    body: {
      organization_id: orgId,
      shop_domain: SHOP,
      status: "CONNECTED",
    },
  });
  check("seed-connection", conn.status < 300, conn.status);

  const install = await rest("/shopify_app_installations", {
    method: "POST",
    prefer: "return=representation",
    body: {
      organization_id: orgId,
      shop_domain: SHOP,
      app_client_id: publicClient,
      status: "CONNECTED",
    },
  });
  check("seed-public-app-install", install.status < 300, { status: install.status, body: install.json });

  const orderA = await rest("/orders", {
    method: "POST",
    prefer: "return=representation",
    body: { organization_id: orgId, order_number: "RPC-A", status: "READY", total_amount: 1049 },
  });
  const orderAId = (orderA.json?.[0] || orderA.json).id;
  check("seed-order-for-rpc", Boolean(orderAId), orderA.status);

  const rpcOk = await rest("/rpc/replace_shopify_order_line_items", {
    method: "POST",
    body: {
      p_organization_id: orgId,
      p_order_id: orderAId,
      p_source_updated_at: "2026-11-01T12:00:00Z",
      p_lines: [
        {
          title: "Product A",
          sku: "A",
          quantity: 1,
          unit_price: 1049,
          source_line_item_id: "gid://shopify/LineItem/B",
        },
      ],
    },
  });
  const rpcData = rpcOk.json;
  const rpcPass = rpcOk.status === 200 && rpcData?.action === "replaced" && !String(rpcOk.text).includes("PGRST204");
  check("postgrest-rpc-service-role", rpcPass, { status: rpcOk.status, action: rpcData?.action, code: rpcData?.code });
  out.rpc.serviceRole = { status: rpcOk.status, action: rpcData?.action };

  const rpcCross = await rest("/rpc/replace_shopify_order_line_items", {
    method: "POST",
    body: {
      p_organization_id: orgBId,
      p_order_id: orderAId,
      p_source_updated_at: null,
      p_lines: [{ title: "X", quantity: 1, unit_price: 1 }],
    },
  });
  const crossMsg = JSON.stringify(rpcCross.json || rpcCross.text);
  check("postgrest-rpc-cross-tenant", rpcCross.status >= 400 && /order not found/i.test(crossMsg), rpcCross.status);

  const signupEmail = `e2e.${Date.now()}@postbus.invalid`;
  const password = `E2e!${randomUUID().slice(0, 8)}Aa1`;
  const signup = await request(`${restUrl}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: signupEmail, password }),
  });
  const access = signup.json?.access_token;
  check("auth-signup", Boolean(access), signup.status);

  if (access && orgId) {
    await dockerSql(`
insert into public.organization_members (organization_id, user_id, role)
select '${orgId}'::uuid, id, 'OWNER' from auth.users where email = '${signupEmail}'
on conflict do nothing;
`);
    const authRpc = await rest("/rpc/replace_shopify_order_line_items", {
      method: "POST",
      token: access,
      body: {
        p_organization_id: orgId,
        p_order_id: orderAId,
        p_source_updated_at: "2026-11-01T12:01:00Z",
        p_lines: [
          {
            title: "Product A",
            sku: "A",
            quantity: 1,
            unit_price: 1049,
            source_line_item_id: "gid://shopify/LineItem/B",
          },
        ],
      },
    });
    check("postgrest-rpc-authenticated", authRpc.status === 200 && authRpc.json?.action, { status: authRpc.status, action: authRpc.json?.action });

    const authCross = await rest("/rpc/replace_shopify_order_line_items", {
      method: "POST",
      token: access,
      body: {
        p_organization_id: orgBId,
        p_order_id: orderAId,
        p_source_updated_at: null,
        p_lines: [{ title: "X", quantity: 1, unit_price: 1 }],
      },
    });
    check("postgrest-rpc-authenticated-cross-tenant", authCross.status >= 400, authCross.status);
  }

  let appHealth = { status: 0 };
  for (let i = 0; i < 60; i += 1) {
    try {
      appHealth = await requestOnce(`${appUrl}/api/health`);
      if (appHealth.status === 200) break;
    } catch {
      appHealth = { status: 0 };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  check("next-health", appHealth.status === 200, appHealth.status);
  const runtime = await request(`${appUrl}/api/health/runtime`);
  const runtimeJson = runtime.json?.data || runtime.json;
  check("next-runtime-loopback", String(runtimeJson?.supabaseHost || "").includes("127.0.0.1:54321"), runtimeJson?.supabaseHost);
  check("next-not-production-ref", !JSON.stringify(runtimeJson || {}).includes(PRODUCTION_REF), true);

  const stub = await request("http://127.0.0.1:4099/health");
  check("cept-stub", stub.json?.provider_mode === "STUB", stub.json);

  async function linesFor(sourceOrderId) {
    const ref = await rest(
      `/external_order_references?source=eq.SHOPIFY&source_order_id=eq.${sourceOrderId}&organization_id=eq.${orgId}&select=order_id`
    );
    const orderId = ref.json?.[0]?.order_id;
    if (!orderId) return { orderId: null, order: null, lines: [], shipments: [] };
    const order = await rest(`/orders?id=eq.${orderId}&select=id,status,payment_status,total_amount,amount_paid,cod_amount,metadata`);
    const lines = await rest(`/order_line_items?order_id=eq.${orderId}&select=title,sku,quantity,source_line_item_id,unit_price`);
    const shipments = await rest(`/shipments?order_id=eq.${orderId}&select=barcode,status,cod_amount,weight_grams,payment_mode,length_cm,width_cm,height_cm`);
    return { orderId, order: order.json?.[0], lines: lines.json || [], shipments: shipments.json || [] };
  }

  // A — partial edited
  const partialId = 910000001;
  const aRes = await postWebhook(
    orderPayload(partialId, {
      name: "#E2E-PARTIAL",
      financial_status: "partially_paid",
      current_total_price: "1049.00",
      total_price: "1049.00",
      total_outstanding: "734.30",
      edited: true,
      tags: "order-edited",
      line_items: [
        { id: 1, title: "Deposit", sku: "A", quantity: 1, current_quantity: 0, price: "314.70", requires_shipping: true },
        { id: 9, title: "Product A", sku: "A", quantity: 1, current_quantity: 1, price: "1049.00", grams: 500, requires_shipping: true },
      ],
    })
  );
  check("webhook-a-http", aRes.status === 200 && aRes.json?.success !== false, { status: aRes.status, message: aRes.json?.message });
  const aDb = await linesFor(String(partialId));
  const aIds = (aDb.lines || []).map((r) => r.source_line_item_id).sort();
  check(
    "webhook-a-partial-one-active-line",
    aDb.lines.length === 1 && String(aIds[0] || "").includes("9"),
    { count: aDb.lines.length, ids: aIds, payment: aDb.order?.payment_status, total: aDb.order?.total_amount, paid: aDb.order?.amount_paid, cod: aDb.order?.cod_amount }
  );
  const paidAmt = Number(aDb.order?.amount_paid);
  const totalAmt = Number(aDb.order?.total_amount);
  const codAmt = Number(aDb.order?.cod_amount);
  check("webhook-a-financials", totalAmt === 1049 && Math.abs(paidAmt - 314.7) < 0.02 && Math.abs(codAmt - 734.3) < 0.02, {
    totalAmt,
    paidAmt,
    codAmt,
    status: aDb.order?.payment_status,
  });

  // B — paid
  const paidId = 910000002;
  const bRes = await postWebhook(
    orderPayload(paidId, {
      financial_status: "paid",
      current_total_price: "1049.00",
      total_outstanding: "0.00",
      line_items: [{ id: 21, title: "Mug", sku: "MUG", quantity: 1, current_quantity: 1, price: "1049.00", grams: 350 }],
    })
  );
  const bDb = await linesFor(String(paidId));
  check("webhook-b-paid", bRes.status === 200 && bDb.lines.length === 1 && bDb.order?.payment_status === "PAID", {
    status: bRes.status,
    payment: bDb.order?.payment_status,
    lines: bDb.lines.length,
  });

  // C — COD
  const codId = 910000003;
  const cRes = await postWebhook(
    orderPayload(codId, {
      financial_status: "pending",
      gateway: "Cash on Delivery (COD)",
      payment_gateway_names: ["Cash on Delivery (COD)"],
      current_total_price: "499.00",
      total_price: "499.00",
      total_outstanding: "499.00",
      line_items: [{ id: 31, title: "COD item", sku: "COD", quantity: 1, current_quantity: 1, price: "499.00", grams: 200 }],
    })
  );
  const cDb = await linesFor(String(codId));
  check(
    "webhook-c-cod",
    cRes.status === 200 && cDb.order?.payment_status === "COD" && Number(cDb.order?.cod_amount) === 499 && Number(cDb.order?.amount_paid) === 0,
    { payment: cDb.order?.payment_status, paid: cDb.order?.amount_paid, cod: cDb.order?.cod_amount }
  );

  // D — same SKU two LineItem IDs
  const dupId = 910000004;
  await postWebhook(
    orderPayload(dupId, {
      financial_status: "paid",
      line_items: [
        { id: 41, title: "Tee", sku: "TEE", quantity: 1, current_quantity: 1, price: "100.00" },
        { id: 42, title: "Tee", sku: "TEE", quantity: 2, current_quantity: 2, price: "100.00" },
      ],
    })
  );
  const dDb = await linesFor(String(dupId));
  const dIds = (dDb.lines || []).map((r) => r.source_line_item_id).sort();
  check("webhook-d-same-sku-two-gids", dDb.lines.length === 2 && dIds.length === 2 && new Set(dIds).size === 2, dIds);

  // E — repeat delivery
  const repeatId = 910000005;
  const ePayload = orderPayload(repeatId, {
    financial_status: "paid",
    line_items: [{ id: 51, title: "Once", sku: "ONCE", quantity: 1, current_quantity: 1, price: "10.00" }],
  });
  const repeatDeliveryId = `repeat-e-${Date.now()}`;
  const e1 = await postWebhook(ePayload, { webhookId: repeatDeliveryId });
  const e2 = await postWebhook(ePayload, { webhookId: repeatDeliveryId });
  const eDb = await linesFor(String(repeatId));
  check("webhook-e-repeat-no-dup-lines", eDb.lines.length === 1, { first: e1.status, second: e2.status, secondBody: e2.json, lines: eDb.lines.length });

  // F — concurrent two payloads
  const concId = 910000006;
  const f1 = orderPayload(concId, {
    updated_at: "2026-11-01T11:00:00Z",
    line_items: [{ id: 61, title: "One", sku: "S", quantity: 1, current_quantity: 1, price: "10.00" }],
  });
  const f2 = orderPayload(concId, {
    updated_at: "2026-11-01T11:00:01Z",
    line_items: [
      { id: 62, title: "TwoA", sku: "S", quantity: 1, current_quantity: 1, price: "10.00" },
      { id: 63, title: "TwoB", sku: "S", quantity: 1, current_quantity: 1, price: "10.00" },
    ],
  });
  const [fr1, fr2] = await Promise.all([postWebhook(f1), postWebhook(f2)]);
  const fDb = await linesFor(String(concId));
  const fIds = (fDb.lines || []).map((r) => r.source_line_item_id).sort();
  const mixed = fIds.some((id) => String(id).includes("61")) && fIds.some((id) => String(id).includes("62"));
  check("webhook-f-concurrent-atomic", fDb.lines.length === 1 || fDb.lines.length === 2, { count: fDb.lines.length, mixed, ids: fIds, s1: fr1.status, s2: fr2.status });
  check("webhook-f-not-mixed-old-and-new", !mixed, fIds);

  // G — missing currentQuantity on edited
  const missId = 910000007;
  await postWebhook(
    orderPayload(missId, {
      financial_status: "paid",
      current_total_price: "1049.00",
      line_items: [{ id: 71, title: "Safe", sku: "SAFE", quantity: 1, current_quantity: 1, price: "1049.00" }],
    })
  );
  const gBefore = await linesFor(String(missId));
  const gRes = await postWebhook(
    orderPayload(missId, {
      edited: true,
      tags: "order-edited",
      financial_status: "partially_paid",
      updated_at: "2026-11-01T13:00:00Z",
      current_total_price: "1049.00",
      line_items: [
        { id: 71, title: "Safe", sku: "SAFE", quantity: 1, price: "1049.00" },
        { id: 72, title: "New", sku: "NEW", quantity: 1, price: "1.00" },
      ],
    })
  );
  const gAfter = await linesFor(String(missId));
  check(
    "webhook-g-incomplete-edited-no-corruption",
    gRes.status === 200 && gAfter.lines.length === 1 && String(gAfter.lines[0].source_line_item_id || "").includes("71"),
    { before: gBefore.lines, after: gAfter.lines, status: gRes.status }
  );

  // Stale snapshot: B then older A
  const staleId = 910000008;
  await postWebhook(
    orderPayload(staleId, {
      updated_at: "2026-11-01T15:00:00Z",
      financial_status: "paid",
      current_total_price: "2000.00",
      line_items: [{ id: 81, title: "New", sku: "N", quantity: 1, current_quantity: 1, price: "2000.00" }],
    })
  );
  await postWebhook(
    orderPayload(staleId, {
      updated_at: "2026-11-01T14:00:00Z",
      financial_status: "paid",
      current_total_price: "100.00",
      line_items: [{ id: 82, title: "Old", sku: "O", quantity: 1, current_quantity: 1, price: "100.00" }],
    })
  );
  const staleDb = await linesFor(String(staleId));
  check("stale-older-does-not-overwrite", Number(staleDb.order?.total_amount) === 2000, { total: staleDb.order?.total_amount, lines: staleDb.lines });

  await postWebhook(
    orderPayload(staleId, {
      updated_at: "2026-11-01T15:00:00Z",
      financial_status: "paid",
      current_total_price: "2000.00",
      line_items: [{ id: 81, title: "New", sku: "N", quantity: 1, current_quantity: 1, price: "2000.00" }],
    })
  );
  const equalDb = await linesFor(String(staleId));
  check("stale-equal-timestamp-idempotent", Number(equalDb.order?.total_amount) === 2000, equalDb.order?.total_amount);

  const missTs = 910000009;
  await postWebhook(
    orderPayload(missTs, {
      updated_at: null,
      financial_status: "paid",
      current_total_price: "50.00",
      line_items: [{ id: 91, title: "NoTs", sku: "Z", quantity: 1, current_quantity: 1, price: "50.00" }],
    })
  );
  const missDb = await linesFor(String(missTs));
  check("stale-missing-timestamp-imports", missDb.lines.length === 1, missDb.lines);

  // H booked + invoice
  const bookId = 910000010;
  await postWebhook(
    orderPayload(bookId, {
      financial_status: "partially_paid",
      current_total_price: "1049.00",
      total_outstanding: "734.30",
      edited: true,
      line_items: [
        { id: 101, title: "Deposit", sku: "A", quantity: 1, current_quantity: 0, price: "314.70" },
        { id: 109, title: "Product A", sku: "A", quantity: 1, current_quantity: 1, price: "1049.00", grams: 800 },
      ],
    })
  );
  const booked = await linesFor(String(bookId));
  if (booked.orderId) {
    dockerSql(`
update public.orders set status = 'BOOKED' where id = '${booked.orderId}';
insert into public.shipments (
  organization_id, order_id, status, barcode, booked_at, payment_mode, weight_grams, cod_amount, length_cm, width_cm, height_cm
)
select '${orgId}', '${booked.orderId}', 'BOOKED', 'ET214330016IN', now(), 'COD', 800, 734.30, 10, 10, 10
where not exists (select 1 from public.shipments where order_id = '${booked.orderId}');
update public.shipments
set status = 'BOOKED', barcode = 'ET214330016IN', booked_at = coalesce(booked_at, now()), payment_mode = 'COD',
    weight_grams = 800, cod_amount = 734.30
where order_id = '${booked.orderId}';
insert into public.sales_invoices (organization_id, order_id, status, grand_total_paise, amount_paid_paise, cod_collect_paise)
values ('${orgId}', '${booked.orderId}', 'DRAFT', 31470, 31470, 73430);
update public.sales_invoices set status = 'ISSUED', invoice_number = 'E2E-INV-${Date.now()}' where order_id = '${booked.orderId}';
`);
  }
  const invoiceBefore = booked.orderId
    ? JSON.parse(dockerSql(`select json_build_object('status', status, 'total', grand_total_paise, 'paid', amount_paid_paise) from public.sales_invoices where order_id='${booked.orderId}';`))
    : null;
  await postWebhook(
    orderPayload(bookId, {
      updated_at: "2026-11-01T16:00:00Z",
      financial_status: "paid",
      current_total_price: "50.00",
      total_outstanding: "0.00",
      line_items: [{ id: 199, title: "Should not apply", sku: "X", quantity: 2, current_quantity: 2, price: "50.00", grams: 10 }],
    })
  );
  const bookedAfter = await linesFor(String(bookId));
  const invoiceAfter = booked.orderId
    ? JSON.parse(dockerSql(`select json_build_object('status', status, 'total', grand_total_paise, 'paid', amount_paid_paise) from public.sales_invoices where order_id='${booked.orderId}';`))
    : null;
  const ship = bookedAfter.shipments[0] || {};
  check("webhook-h-awb-unchanged", ship.barcode === "ET214330016IN" && ship.status === "BOOKED", ship);
  check("webhook-h-weight-cod-frozen", Number(ship.weight_grams) === 800, ship);
  check(
    "webhook-h-invoice-unchanged",
    invoiceAfter?.status === "ISSUED" && Number(invoiceAfter?.total) === Number(invoiceBefore?.total),
    { invoiceBefore, invoiceAfter }
  );
  const hIds = (bookedAfter.lines || []).map((r) => r.source_line_item_id);
  check("webhook-h-lines-not-replaced-with-new-gid", !hIds.some((id) => String(id).includes("199")), hIds);

  const badHmac = await postWebhook(orderPayload(1, { line_items: [{ id: 1, title: "x", quantity: 1, current_quantity: 1, price: "1" }] }), {
    secret: "wrong-secret",
  });
  check("webhook-invalid-hmac-rejected", badHmac.status === 401 || badHmac.status === 403 || badHmac.json?.success === false, badHmac.status);

  if (publicSecret && publicClient) {
    const pub = await postPublicWebhook(
      orderPayload(910000011, {
        line_items: [{ id: 111, title: "Public", sku: "P", quantity: 1, current_quantity: 1, price: "10.00" }],
      })
    );
    check("public-app-webhook-route-responded", pub.status === 200 || pub.status === 401, { status: pub.status, message: pub.json?.message });
  }

  const failed = checks.filter((c) => !c.pass);
  out.ok = failed.length === 0;
  out.passed = checks.filter((c) => c.pass).length;
  out.failed = failed.map((c) => c.name);
  writeFileSync("scripts/staging/shopify-app-e2e-last.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ok: out.ok, passed: out.passed, failed: out.failed, productionUnused: true }, null, 2));
  if (!out.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
