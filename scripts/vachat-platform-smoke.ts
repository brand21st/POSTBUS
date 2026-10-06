/**
 * Phase 12 — non-destructive platform VaChat smoke (post@post.com).
 * Sends at most one session text to +918848772371. Does not mutate orders.
 */
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { listEligibleOrders } from "@/modules/vachat/eligible-orders";
import {
  getPlatformVachatConfig,
  isPlatformVachatActive,
  publicPlatformVachatStatus,
} from "@/modules/vachat/platform-config";
import { sendVachatSessionText } from "@/modules/vachat/send";
import { probeVachatMe, vachatHeaders } from "@/modules/vachat/service";

const CUSTOMER = "+918848772371";
const PLATFORM = "+918618456029";
const ACCOUNT = "post@post.com";

function pickPublic(me: unknown) {
  const root = me && typeof me === "object" ? (me as Record<string, unknown>) : {};
  const data =
    root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : root;
  return {
    account: data.account ?? data.email ?? data.user ?? null,
    phone: data.phone ?? data.whatsapp ?? data.display_phone ?? null,
    name: data.name ?? data.assistant ?? null,
    keys: Object.keys(data).filter((key) => !/secret|token|key|password|hmac/i.test(key)),
  };
}

async function main() {
  if (!hasAdminClient()) {
    console.log(JSON.stringify({ ok: false, step: "env", error: "Supabase admin client not configured." }));
    process.exit(1);
  }

  const config = await getPlatformVachatConfig();
  const status = publicPlatformVachatStatus(config);
  const report: Record<string, unknown> = {
    accountExpected: ACCOUNT,
    platformWhatsappExpected: PLATFORM,
    customer: CUSTOMER,
    platform: {
      enabled: status.enabled,
      connected: status.connected,
      source: status.source,
      apiBaseUrl: status.apiBaseUrl,
      hasApiKey: status.hasApiKey,
      webhookSecretConfigured: status.webhookSecretConfigured,
      webhookUrl: status.webhookUrl,
      webhookEndpointId: status.webhookEndpointId,
      mcpUrl: status.mcpUrl,
      mcpAccount: status.mcpAccount,
      mcpWhatsapp: status.mcpWhatsapp,
      lastError: status.lastError,
      lastVerifiedAt: status.lastVerifiedAt,
    },
  };

  if (!isPlatformVachatActive(config)) {
    console.log(JSON.stringify({ ok: false, step: "platform_inactive", ...report }, null, 2));
    process.exit(1);
  }

  const me = await probeVachatMe(config.apiBaseUrl, config.apiKey);
  report.vachatMe = pickPublic(me);

  const identityRes = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}/api/postbus/identity`, {
    headers: vachatHeaders(config.apiKey),
    signal: AbortSignal.timeout(8000),
  });
  const identityJson = (await identityRes.json().catch(() => null)) as Record<string, unknown> | null;
  report.identityHttp = identityRes.status;
  report.identity = pickPublic(identityJson);

  const supabase = createAdminClient();
  const { data: session, error: sessionError } = await supabase
    .from("whatsapp_support_sessions")
    .select("id, source, phone_digits, state, expires_at, selected_order_id, selected_organization_id")
    .eq("phone_digits", "8848772371")
    .maybeSingle();
  report.sessionRead = sessionError
    ? { error: sessionError.code ?? "query_failed", message: sessionError.message }
    : session;

  const listed = await listEligibleOrders(supabase, { phone: CUSTOMER, now: new Date() });
  report.eligible = listed.choices.map((row) => ({
    merchant_name: row.merchant_name,
    order_ref: row.order_ref,
    status: row.status,
  }));

  const skipSend = process.env.SMOKE_SKIP_SEND === "1";
  const sent = skipSend
    ? { sent: false as const, skipped: true }
    : await sendVachatSessionText(
        CUSTOMER,
        "PostBus platform smoke test (post@post.com / +918618456029). You can ignore this message."
      );
  report.outboundSessionText = sent;

  report.ok = skipSend || Boolean("sent" in sent && sent.sent);
  report.inboundNote =
    "Inbound Meta→VaChat→HMAC webhook cannot be synthesized from this script. Send 'Where is my order?' from +918848772371 to +918618456029 to exercise picker/bind.";
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 2);
}

main().catch((error) => {
  console.log(
    JSON.stringify({
      ok: false,
      step: "exception",
      error: error instanceof Error ? error.message : "unknown",
    })
  );
  process.exit(1);
});
