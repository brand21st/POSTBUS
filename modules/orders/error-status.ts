import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError, logInfo } from "@/lib/logger";
import { consumeAiCredit, getAiCreditsRemaining } from "@/modules/ai-credits/service";
import { isAiAddressCheckEnabled } from "@/modules/automation/service";
import {
  OPENROUTER_API_BASE,
  getPlatformOpenRouterConfig,
  openRouterReferer,
} from "@/modules/openrouter/platform-config";
import {
  collectErrorFacts,
  finalErrorFromFacts,
  type ErrorFact,
  type ErrorFactKind,
} from "@/modules/orders/error-facts";

const LIMIT = 50;
const CACHE_MS = 10 * 60 * 1000;

type Cached = { at: number; status: string; summary: string };
const cache = new Map<string, Cached>();

const SCHEMA = {
  name: "postbus_error_status",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      orders: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            orderId: { type: "string" },
            status: { type: "string" },
            summary: { type: "string" },
          },
          required: ["orderId", "status", "summary"],
        },
      },
    },
    required: ["orders"],
  },
};

const SYSTEM = `You write the final error status for PostBus orders that have not been booked.
You receive recorded facts only. Return JSON {"orders":[{"orderId":"","status":"","summary":""}]}.
Rules:
- Use only the facts for that order. Do not invent a payment, address, parcel, PIN, or India Post problem.
- status is 2 to 4 words, such as Booking failed, Payment error, Invoice error, Address error, Parcel size missing, Weight missing.
- summary is one sentence saying what happened and why booking did not complete. Keep any India Post error code exactly as given.
- If a provider, payment, invoice, delivery, or shipment failure exists, that is the final status. Mention address or parcel only as an additional fact in the same sentence.
- If the only facts are address or parcel, say that plainly.
- Do not include names, phone numbers, or email addresses.
- Return one item for every order id you were given.`;

export type OrderErrorStatus = {
  orderId: string;
  status: string;
  summary: string;
  source: "ai" | "rules";
  kind?: ErrorFactKind;
  /** Exact recorded errors, unedited, so the UI can show what India Post actually said. */
  facts: ErrorFact[];
};

function factHash(facts: ErrorFact[]) {
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex").slice(0, 16);
}

function preferredShipment(shipments: unknown) {
  const rows = Array.isArray(shipments) ? shipments : [];
  const ranked = [...rows].sort((left, right) =>
    String((right as { created_at?: string }).created_at ?? "").localeCompare(
      String((left as { created_at?: string }).created_at ?? "")
    )
  );
  return (
    ranked.find((item) => String((item as { status?: string }).status ?? "").toUpperCase() !== "CANCELLED") ??
    ranked[0] ??
    null
  );
}

function clip(value: string, max: number) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function parseErrorStatusContent(content: string, orderIds: string[]) {
  try {
    const parsed = JSON.parse(content) as { orders?: Array<{ orderId?: string; status?: string; summary?: string }> };
    const byId = new Map<string, { status: string; summary: string }>();
    for (const row of parsed.orders ?? []) {
      const orderId = String(row.orderId ?? "");
      const status = clip(String(row.status ?? ""), 40);
      const summary = clip(String(row.summary ?? ""), 240);
      if (orderIds.includes(orderId) && status && summary) byId.set(orderId, { status, summary });
    }
    return byId;
  } catch {
    return new Map<string, { status: string; summary: string }>();
  }
}

async function askModel(apiKey: string, model: string, payload: Array<{ orderId: string; facts: ErrorFact[] }>) {
  const body = {
    model,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify({ orders: payload }) },
    ],
  };
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": openRouterReferer(),
        "X-Title": "PostBus",
      },
      body: JSON.stringify({
        ...body,
        response_format:
          attempt === 0 ? { type: "json_schema", json_schema: SCHEMA } : { type: "json_object" },
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (response.ok || (response.status !== 400 && response.status !== 429 && response.status < 500)) break;
  }
  if (!response?.ok) {
    logError("orders.error_status_ai_failed", { status: response?.status ?? 0 });
    return new Map<string, { status: string; summary: string }>();
  }
  const json = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  return parseErrorStatusContent(json?.choices?.[0]?.message?.content ?? "", payload.map((row) => row.orderId));
}

export async function explainOrderErrorStatuses(
  supabase: SupabaseClient,
  ctx: TenantContext,
  orderIds: string[]
): Promise<{ orders: OrderErrorStatus[] }> {
  const ids = [...new Set(orderIds.map((id) => id.trim()).filter(Boolean))].slice(0, LIMIT);
  if (!ids.length) return { orders: [] };
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, status, payment_status, parcel_weight_mode, parcel_weight_grams, shipping_address:addresses!shipping_address_id(address_validation_status, address_validation_errors), shipments(status, last_error, last_error_code, length_cm, width_cm, height_cm, weight_grams, created_at), shipping_invoices(status, error_message), order_line_items(quantity, weight_grams)"
    )
    .eq("organization_id", ctx.organizationId)
    .in("id", ids);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

  const allowAi = await isAiAddressCheckEnabled(supabase, ctx.organizationId);
  const rows = new Map((data ?? []).map((row) => [String(row.id), row]));
  const pending: Array<{ orderId: string; facts: ErrorFact[]; hash: string }> = [];
  const orders: OrderErrorStatus[] = ids.map((orderId) => {
    const row = rows.get(orderId);
    const shipment = preferredShipment(row?.shipments);
    const invoices = Array.isArray(row?.shipping_invoices) ? row.shipping_invoices : row?.shipping_invoices ? [row.shipping_invoices] : [];
    const facts = row
      ? collectErrorFacts({
          status: row.status,
          payment_status: row.payment_status,
          parcel_weight_mode: row.parcel_weight_mode,
          parcel_weight_grams: row.parcel_weight_grams,
          lineItems: row.order_line_items as FactLine[] | null,
          shipment: shipment as FactSourceShipment,
          invoice: (invoices[0] ?? null) as FactSourceInvoice,
          shippingAddress: row.shipping_address as FactSourceAddress,
        })
      : [];
    const fallback = finalErrorFromFacts(facts);
    const hash = factHash(facts);
    const cached = allowAi ? cache.get(`${ctx.organizationId}:${orderId}:${hash}`) : undefined;
    if (cached && Date.now() - cached.at < CACHE_MS) {
      return { orderId, status: cached.status, summary: cached.summary, source: "ai" as const, kind: fallback?.kind, facts };
    }
    if (facts.length) pending.push({ orderId, facts, hash });
    return {
      orderId,
      status: fallback?.status ?? "",
      summary: fallback?.summary ?? "",
      source: "rules" as const,
      kind: fallback?.kind,
      facts,
    };
  });

  if (!allowAi || !pending.length) return { orders: orders.filter((row) => row.status) };

  try {
    const config = await getPlatformOpenRouterConfig();
    const credits = await getAiCreditsRemaining(supabase, ctx.organizationId);
    if (config.enabled && config.apiKey && credits > 0) {
      const explained = await askModel(config.apiKey, config.model, pending.map(({ orderId, facts }) => ({ orderId, facts })));
      if (explained.size) {
        await consumeAiCredit(supabase, ctx.organizationId, {
          reason: "AI_ERROR_STATUS",
          idempotencyKey: `error-status:${ctx.organizationId}:${factHash(pending.flatMap((row) => row.facts))}`,
        });
        logInfo("orders.error_status_ai", {
          organizationId: ctx.organizationId,
          model: config.model,
          orders: explained.size,
        });
      }
      for (const row of orders) {
        const ai = explained.get(row.orderId);
        if (!ai) continue;
        row.status = ai.status;
        row.summary = ai.summary;
        row.source = "ai";
        const match = pending.find((item) => item.orderId === row.orderId);
        if (match) cache.set(`${ctx.organizationId}:${row.orderId}:${match.hash}`, { at: Date.now(), ...ai });
      }
    }
  } catch (failure) {
    logError("orders.error_status_ai_failed", {
      message: failure instanceof Error ? failure.name : "unknown",
    });
  }

  return { orders: orders.filter((row) => row.status) };
}

type FactLine = { quantity?: number | null; weight_grams?: number | null };
type FactSourceShipment = NonNullable<Parameters<typeof collectErrorFacts>[0]["shipment"]>;
type FactSourceInvoice = NonNullable<Parameters<typeof collectErrorFacts>[0]["invoice"]>;
type FactSourceAddress = NonNullable<Parameters<typeof collectErrorFacts>[0]["shippingAddress"]>;
