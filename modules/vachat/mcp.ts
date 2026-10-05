import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { safeEqual } from "@/lib/security/crypto";
import {
  answerFromKnowledge,
  pickOrder,
} from "@/modules/vachat/assistant";
import {
  CUSTOMER_PHONE_ONLY_REPLY,
  findOrganizationsForCustomerPhone,
  loadMerchantKnowledge,
  phoneDigitsForLookup,
  VACHAT_ASSISTANT_ACCOUNT,
  VACHAT_ASSISTANT_NAME,
  type MerchantKnowledge,
  type MerchantKnowledgeOrder,
} from "@/modules/vachat/knowledge";
import {
  getPlatformVachatConfig,
  isPlatformVachatActive,
} from "@/modules/vachat/platform-config";

export const MCP_PROTOCOL_VERSION = "2025-03-26";
export const SEARCH_ORDER_DETAILS_TOOL = "search_order_details";

export type SearchOrderDetailsArgs = {
  whatsapp: string;
  query?: string;
  merchant_id?: string;
  account?: string;
};

export type OrderDetailsHit = {
  merchant_id: string;
  merchant_name: string;
  merchant_phone: string | null;
  merchant_website: string | null;
  merchant_email: string | null;
  merchant_gstin: string | null;
  merchant_address: string | null;
  order_number: string;
  created_at: string | null;
  status: string;
  payment_status: string | null;
  amount: string | null;
  items: string[];
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_total: string | null;
  tracking_number: string | null;
  shipment_status: string | null;
  booked_at: string | null;
  last_scan: string | null;
  last_office: string | null;
  tracking_url: string | null;
  timeline: MerchantKnowledgeOrder["timeline"];
};

export type OrderDetailsSearchResult = {
  account: string;
  assistant: string;
  customer_whatsapp: string | null;
  found: boolean;
  answer: string;
  results: OrderDetailsHit[];
};

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

export function mcpTools() {
  return [
    {
      name: SEARCH_ORDER_DETAILS_TOOL,
      description:
        "Search PostBus live tenant data for the chatting customer's order details, shipment, India Post tracking ID, tracking timeline, and invoice. VaChat account post@post.com. Always pass the sender WhatsApp number. Never look up another customer's records.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["whatsapp"],
        properties: {
          whatsapp: {
            type: "string",
            description: "Customer WhatsApp number currently chatting (E.164 or last 10 Indian digits).",
          },
          query: {
            type: "string",
            description:
              "Optional customer question, order number, India Post tracking ID, or invoice number.",
          },
          merchant_id: {
            type: "string",
            description: "Optional PostBus organization UUID if VaChat already knows the merchant.",
          },
          account: {
            type: "string",
            description: "Must be post@post.com when sent.",
          },
        },
      },
    },
  ];
}

export function initializeResult() {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: {
      name: "postbus-vachat",
      version: "1.0.0",
      title: VACHAT_ASSISTANT_NAME,
    },
    instructions:
      "When a WhatsApp user on post@post.com asks about an order, shipment, tracking ID, timeline, or invoice, call search_order_details with that sender's WhatsApp number. Answer only from the tool result.",
  };
}

export function parseSearchOrderDetailsArgs(raw: unknown): SearchOrderDetailsArgs {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const whatsapp = String(record.whatsapp ?? record.phone ?? record.from ?? record.wa_id ?? "").trim();
  if (!phoneDigitsForLookup(whatsapp)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "whatsapp is required (the customer number that is chatting)."
    );
  }
  const account = String(record.account ?? VACHAT_ASSISTANT_ACCOUNT).trim() || VACHAT_ASSISTANT_ACCOUNT;
  if (account.toLowerCase() !== VACHAT_ASSISTANT_ACCOUNT) {
    throw new AppError(ERROR_CODES.FORBIDDEN, `MCP search is only for ${VACHAT_ASSISTANT_ACCOUNT}.`);
  }
  return {
    whatsapp,
    query: String(record.query ?? record.question ?? record.text ?? "").trim() || undefined,
    merchant_id: String(record.merchant_id ?? record.merchantId ?? "").trim() || undefined,
    account: VACHAT_ASSISTANT_ACCOUNT,
  };
}

function recencyMs(order: MerchantKnowledgeOrder) {
  const stamp = order.bookedAt || order.createdAt || order.timeline[0]?.at || "";
  const value = Date.parse(stamp);
  return Number.isFinite(value) ? value : 0;
}

function toHit(knowledge: MerchantKnowledge, order: MerchantKnowledgeOrder): OrderDetailsHit {
  return {
    merchant_id: knowledge.merchantId,
    merchant_name: knowledge.organization.name,
    merchant_phone: knowledge.organization.phone,
    merchant_website: knowledge.organization.website,
    merchant_email: knowledge.organization.email,
    merchant_gstin: knowledge.organization.gstin,
    merchant_address: knowledge.organization.address,
    order_number: order.orderNumber,
    created_at: order.createdAt ?? null,
    status: order.status,
    payment_status: order.paymentStatus,
    amount: order.amount,
    items: order.items,
    invoice_number: order.invoiceNumber,
    invoice_date: order.invoiceDate,
    invoice_total: order.invoiceTotal,
    tracking_number: order.trackingNumber,
    shipment_status: order.shipmentStatus,
    booked_at: order.bookedAt,
    last_scan: order.lastScan,
    last_office: order.lastOffice,
    tracking_url: order.trackingUrl,
    timeline: order.timeline,
  };
}

function sortOrders(orders: MerchantKnowledgeOrder[]) {
  return [...orders].sort((a, b) => recencyMs(b) - recencyMs(a));
}

export function formatOrderDetailsText(result: OrderDetailsSearchResult) {
  if (!result.found) return result.answer;
  const lines = [
    `${result.assistant}. VaChat account ${result.account}.`,
    `Customer WhatsApp ${result.customer_whatsapp}.`,
    result.answer,
  ];
  for (const row of result.results) {
    lines.push(
      [
        `Merchant ${row.merchant_name}`,
        `order ${row.order_number}`,
        `status ${row.status}`,
        row.payment_status ? `payment ${row.payment_status}` : null,
        row.amount ? `amount ${row.amount}` : null,
        row.items.length ? `items ${row.items.join("; ")}` : null,
        row.invoice_number ? `invoice ${row.invoice_number}` : null,
        row.tracking_number ? `India Post tracking ID ${row.tracking_number}` : null,
        row.shipment_status ? `shipment ${row.shipment_status}` : null,
        row.last_scan ? `now ${row.last_scan}` : null,
        row.last_office ? `at ${row.last_office}` : null,
        row.tracking_url ? `track ${row.tracking_url}` : null,
      ]
        .filter(Boolean)
        .join(". ") + "."
    );
  }
  return lines.join("\n");
}

export async function searchOrderDetails(
  supabase: SupabaseClient,
  args: SearchOrderDetailsArgs
): Promise<OrderDetailsSearchResult> {
  const empty: OrderDetailsSearchResult = {
    account: VACHAT_ASSISTANT_ACCOUNT,
    assistant: VACHAT_ASSISTANT_NAME,
    customer_whatsapp: phoneDigitsForLookup(args.whatsapp),
    found: false,
    answer: CUSTOMER_PHONE_ONLY_REPLY,
    results: [],
  };

  const hinted = args.merchant_id?.trim() || "";
  const orgIds = hinted ? [hinted] : await findOrganizationsForCustomerPhone(supabase, args.whatsapp);
  const bundles: MerchantKnowledge[] = [];
  for (const organizationId of orgIds) {
    const knowledge = await loadMerchantKnowledge(supabase, organizationId, {
      customerPhone: args.whatsapp,
    });
    if (knowledge?.orders.length) bundles.push(knowledge);
  }
  if (!bundles.length) return empty;

  const query = args.query?.trim() || "order details";
  const hits: OrderDetailsHit[] = [];
  let focused: { knowledge: MerchantKnowledge; order: MerchantKnowledgeOrder } | null = null;

  for (const knowledge of bundles) {
    const ranked = sortOrders(knowledge.orders);
    const picked = pickOrder({ ...knowledge, orders: ranked }, query) ?? ranked[0] ?? null;
    for (const order of ranked) hits.push(toHit(knowledge, order));
    if (picked && (!focused || recencyMs(picked) > recencyMs(focused.order))) {
      focused = { knowledge: { ...knowledge, orders: ranked }, order: picked };
    }
  }

  hits.sort((a, b) => {
    const left = Date.parse(a.booked_at || a.created_at || a.timeline[0]?.at || "") || 0;
    const right = Date.parse(b.booked_at || b.created_at || b.timeline[0]?.at || "") || 0;
    return right - left;
  });

  if (!focused) return empty;
  return {
    account: VACHAT_ASSISTANT_ACCOUNT,
    assistant: VACHAT_ASSISTANT_NAME,
    customer_whatsapp: empty.customer_whatsapp,
    found: true,
    answer: answerFromKnowledge(focused.knowledge, query),
    results: hits.slice(0, 20),
  };
}

export function mcpToolCallResult(result: OrderDetailsSearchResult) {
  return {
    content: [{ type: "text", text: formatOrderDetailsText(result) }],
    structuredContent: result,
    isError: false,
  };
}

function rpcError(id: JsonRpcId | undefined, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function rpcResult(id: JsonRpcId | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function asRequest(raw: unknown): JsonRpcRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as JsonRpcRequest;
}

export function isJsonRpcPayload(raw: unknown) {
  if (Array.isArray(raw)) return raw.some((item) => asRequest(item)?.jsonrpc === "2.0");
  return asRequest(raw)?.jsonrpc === "2.0" || Boolean(asRequest(raw)?.method);
}

export async function handleMcpRpc(
  raw: unknown,
  search: (args: SearchOrderDetailsArgs) => Promise<OrderDetailsSearchResult>
): Promise<{ status: number; body: unknown | null }> {
  if (Array.isArray(raw)) {
    const bodies = [];
    for (const item of raw) {
      const handled = await handleMcpRpc(item, search);
      if (handled.body != null) bodies.push(handled.body);
    }
    return { status: 200, body: bodies };
  }

  const req = asRequest(raw);
  if (!req?.method) {
    return { status: 400, body: rpcError(null, -32600, "Invalid MCP request.") };
  }

  const isNotification = req.id === undefined && req.method.startsWith("notifications/");
  if (isNotification) return { status: 202, body: null };

  const id = req.id;
  if (req.method === "initialize") return { status: 200, body: rpcResult(id, initializeResult()) };
  if (req.method === "ping") return { status: 200, body: rpcResult(id, {}) };
  if (req.method === "tools/list") return { status: 200, body: rpcResult(id, { tools: mcpTools() }) };
  if (req.method === "resources/list") return { status: 200, body: rpcResult(id, { resources: [] }) };
  if (req.method === "prompts/list") return { status: 200, body: rpcResult(id, { prompts: [] }) };

  if (req.method === "tools/call") {
    const params =
      req.params && typeof req.params === "object" ? (req.params as Record<string, unknown>) : {};
    const name = String(params.name ?? "").trim();
    if (name !== SEARCH_ORDER_DETAILS_TOOL) {
      return { status: 200, body: rpcError(id, -32601, `Unknown tool: ${name || "(missing)"}`) };
    }
    try {
      const args = parseSearchOrderDetailsArgs(params.arguments ?? params);
      const result = await search(args);
      return { status: 200, body: rpcResult(id, mcpToolCallResult(result)) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool call failed.";
      return { status: 200, body: rpcError(id, -32602, message) };
    }
  }

  return { status: 200, body: rpcError(id, -32601, `Unknown method: ${req.method}`) };
}

export async function authorizeVachatMcp(headers: Headers) {
  const platform = await getPlatformVachatConfig();
  if (!isPlatformVachatActive(platform)) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "PostBus WhatsApp is not active.");
  }
  const bearer = headers.get("authorization");
  const token = bearer?.toLowerCase().startsWith("bearer ")
    ? bearer.slice(7).trim()
    : (headers.get("x-api-key")?.trim() ?? "");
  if (!token || !safeEqual(token, platform.apiKey)) {
    throw new AppError(ERROR_CODES.AUTH_REQUIRED, "Use the PostBus WhatsApp VaChat API key as a Bearer token.");
  }
  return platform;
}

export function mcpCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, X-Api-Key, Mcp-Session-Id, MCP-Protocol-Version",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
  };
}
