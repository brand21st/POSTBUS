import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logInfo } from "@/lib/logger";
import { safeEqual } from "@/lib/security/crypto";
import {
  POSTBUS_PUBLIC_TRACK_URL,
  VACHAT_ASSISTANT_ACCOUNT,
  VACHAT_ASSISTANT_NAME,
  type MerchantKnowledgeOrder,
} from "@/modules/vachat/knowledge";
import {
  getPlatformVachatConfig,
  isPlatformVachatActive,
} from "@/modules/vachat/platform-config";
import {
  resolveTrustedSupportSessionId,
  type PlatformSupportMcpContext,
} from "@/modules/vachat/mcp-context";
import {
  formatBoundSupportOrderReply,
  getBoundSupportOrder,
  type BoundSupportOrder,
} from "@/modules/vachat/support-order";

export const MCP_PROTOCOL_VERSION = "2025-03-26";
export const SEARCH_ORDER_DETAILS_TOOL = "search_order_details";
export const SEARCH_MERCHANT_ORGANIZATION_TOOL = "search_merchant_organization";
export const MCP_UNAUTHORIZED = "Unauthorized request.";
export const MCP_ORDER_UNAVAILABLE = "Order access is not available in this support session.";

export type PlatformMcpAuthContext = PlatformSupportMcpContext;

export type SearchOrderDetailsArgs = {
  query?: string;
  account?: string;
  now?: Date;
  requestId?: string;
  tool?: string;
};

export type OrderDetailsHit = {
  merchant_id: string;
  merchant_name: string;
  merchant_phone: string | null;
  merchant_website: string | null;
  merchant_email: string | null;
  merchant_gstin: string | null;
  merchant_address: string | null;
  organization: {
    id: string;
    name: string;
    phone: string | null;
    website: string | null;
    email: string | null;
    gstin: string | null;
    address: string | null;
  };
  order_information: {
    order_number: string;
    created_at: string | null;
    status: string;
    payment_status: string | null;
    amount: string | null;
    items: string[];
    customer_name: string | null;
  };
  shipment_information: {
    status: string | null;
    booked_at: string | null;
    weight_grams: string | null;
  };
  invoice: {
    number: string | null;
    date: string | null;
    total: string | null;
  };
  tracking: {
    india_post_tracking_id: string | null;
    tracking_link: string;
    last_scan: string | null;
    last_office: string | null;
    timeline: MerchantKnowledgeOrder["timeline"];
  };
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
  tracking_url: string;
  timeline: MerchantKnowledgeOrder["timeline"];
};

export type MerchantOrganizationHit = {
  merchant_id: string;
  name: string;
  phone: string | null;
  website: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
};

export type OrderDetailsSearchResult = {
  account: string;
  assistant: string;
  fetched_at: string;
  live: true;
  tracking_page: string;
  customer_whatsapp: string | null;
  found: boolean;
  answer: string;
  organizations: MerchantOrganizationHit[];
  results: OrderDetailsHit[];
};

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

const IGNORED_IDENTITY = {
  type: "string",
  description:
    "Ignored. Not used for authorization. Order, merchant, customer, and tracking come from the support session.",
};

export function mcpTools() {
  const account = {
    type: "string",
    description: "Must be post@post.com when sent.",
  };
  const query = {
    type: "string",
    description: "Optional customer question. Does not select or authorize an order.",
  };
  const identityProperties = {
    session_id: IGNORED_IDENTITY,
    whatsapp: IGNORED_IDENTITY,
    phone: IGNORED_IDENTITY,
    from: IGNORED_IDENTITY,
    wa_id: IGNORED_IDENTITY,
    customer_id: IGNORED_IDENTITY,
    order_id: IGNORED_IDENTITY,
    organization_id: IGNORED_IDENTITY,
    merchant_id: IGNORED_IDENTITY,
    tracking_number: IGNORED_IDENTITY,
  };
  return [
    {
      name: SEARCH_ORDER_DETAILS_TOOL,
      description:
        "Live-fetch the bound support session's merchant, order, shipment, and India Post tracking. Session context is injected by PostBus, not by this tool's arguments.",
      inputSchema: {
        type: "object",
        additionalProperties: true,
        properties: {
          query,
          account,
          ...identityProperties,
        },
      },
    },
    {
      name: SEARCH_MERCHANT_ORGANIZATION_TOOL,
      description:
        "Live-fetch the bound support session's merchant organization. Session context is injected by PostBus, not by this tool's arguments.",
      inputSchema: {
        type: "object",
        additionalProperties: true,
        properties: {
          query,
          account,
          ...identityProperties,
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
      "PostBus WhatsApp is +918618456029 on VaChat account post@post.com. Tools search_order_details and search_merchant_organization are executed by the PostBus webhook with a server-trusted support session. Do not pass session_id, whatsapp, order_id, merchant_id, or tracking_number as authorization. Always send https://www.postbus.in/track (with ?tracking=ID when an India Post tracking ID exists). Answer only from the live tool result.",
  };
}

export function parseSearchOrderDetailsArgs(raw: unknown): SearchOrderDetailsArgs {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const account = String(record.account ?? VACHAT_ASSISTANT_ACCOUNT).trim() || VACHAT_ASSISTANT_ACCOUNT;
  if (account.toLowerCase() !== VACHAT_ASSISTANT_ACCOUNT) {
    throw new AppError(ERROR_CODES.FORBIDDEN, `MCP search is only for ${VACHAT_ASSISTANT_ACCOUNT}.`);
  }
  return {
    query: String(record.query ?? record.question ?? record.text ?? "").trim() || undefined,
    account: VACHAT_ASSISTANT_ACCOUNT,
  };
}

function emptyResult(answer: string): OrderDetailsSearchResult {
  return {
    account: VACHAT_ASSISTANT_ACCOUNT,
    assistant: VACHAT_ASSISTANT_NAME,
    fetched_at: new Date().toISOString(),
    live: true,
    tracking_page: POSTBUS_PUBLIC_TRACK_URL,
    customer_whatsapp: null,
    found: false,
    answer,
    organizations: [],
    results: [],
  };
}

function toHit(order: BoundSupportOrder): OrderDetailsHit {
  const timeline = order.last_event
    ? [
        {
          at: order.last_event.at,
          office: order.last_event.office,
          description: order.last_event.description,
        },
      ]
    : [];
  const organization = {
    id: "",
    name: order.merchant_name,
    phone: order.merchant_phone,
    website: order.merchant_website,
    email: order.merchant_email,
    gstin: null,
    address: null,
  };
  return {
    merchant_id: "",
    merchant_name: order.merchant_name,
    merchant_phone: order.merchant_phone,
    merchant_website: order.merchant_website,
    merchant_email: order.merchant_email,
    merchant_gstin: null,
    merchant_address: null,
    organization,
    order_information: {
      order_number: order.order_ref,
      created_at: order.created_at,
      status: order.order_status,
      payment_status: order.payment_status,
      amount: order.amount,
      items: order.items,
      customer_name: null,
    },
    shipment_information: {
      status: order.shipment_status,
      booked_at: order.booked_at,
      weight_grams: null,
    },
    invoice: { number: order.invoice_number, date: null, total: order.invoice_total },
    tracking: {
      india_post_tracking_id: order.tracking_number,
      tracking_link: order.tracking_link,
      last_scan: order.last_event?.description ?? null,
      last_office: order.last_event?.office ?? null,
      timeline,
    },
    order_number: order.order_ref,
    created_at: order.created_at,
    status: order.order_status,
    payment_status: order.payment_status,
    amount: order.amount,
    items: order.items,
    invoice_number: order.invoice_number,
    invoice_date: null,
    invoice_total: order.invoice_total,
    tracking_number: order.tracking_number,
    shipment_status: order.shipment_status,
    booked_at: order.booked_at,
    last_scan: order.last_event?.description ?? null,
    last_office: order.last_event?.office ?? null,
    tracking_url: order.tracking_link,
    timeline,
  };
}

function toOrganizationHit(order: BoundSupportOrder): MerchantOrganizationHit {
  return {
    merchant_id: "",
    name: order.merchant_name,
    phone: order.merchant_phone,
    website: order.merchant_website,
    email: order.merchant_email,
    gstin: null,
    address: null,
  };
}

export function formatOrderDetailsText(result: OrderDetailsSearchResult) {
  if (!result.found) return result.answer;
  const lines = [
    `${result.assistant}. VaChat account ${result.account}. Live PostBus fetch ${result.fetched_at}.`,
    result.customer_whatsapp ? `Customer WhatsApp ${result.customer_whatsapp}.` : null,
    `Tracking page ${result.tracking_page}.`,
    result.answer,
  ].filter(Boolean) as string[];
  for (const org of result.organizations) {
    lines.push(
      [
        `Merchant organization ${org.name}`,
        org.phone ? `phone ${org.phone}` : null,
        org.website ? `website ${org.website}` : null,
        org.email ? `email ${org.email}` : null,
        org.gstin ? `GSTIN ${org.gstin}` : null,
        org.address ? `address ${org.address}` : null,
      ]
        .filter(Boolean)
        .join(". ") + "."
    );
  }
  for (const row of result.results) {
    const timeline = row.tracking.timeline
      .slice(0, 8)
      .map((item) => [item.at, item.office, item.description].filter(Boolean).join(" "))
      .filter(Boolean)
      .join(" | ");
    lines.push(
      [
        `Order information ${row.order_information.order_number}`,
        `order status ${row.order_information.status}`,
        row.order_information.payment_status ? `payment ${row.order_information.payment_status}` : null,
        row.order_information.amount ? `amount ${row.order_information.amount}` : null,
        row.order_information.items.length ? `items ${row.order_information.items.join("; ")}` : null,
        row.invoice.number ? `invoice ${row.invoice.number}` : null,
        row.invoice.date ? `invoice date ${row.invoice.date}` : null,
        row.invoice.total ? `invoice total ${row.invoice.total}` : null,
        `shipment ${row.shipment_information.status ?? "not created"}`,
        row.shipment_information.booked_at ? `booked ${row.shipment_information.booked_at}` : null,
        row.tracking.india_post_tracking_id
          ? `India Post tracking ID ${row.tracking.india_post_tracking_id}`
          : null,
        `tracking link ${row.tracking.tracking_link}`,
        row.tracking.last_scan ? `now ${row.tracking.last_scan}` : null,
        row.tracking.last_office ? `at ${row.tracking.last_office}` : null,
        timeline ? `timeline ${timeline}` : null,
      ]
        .filter(Boolean)
        .join(". ") + "."
    );
  }
  return lines.join("\n");
}

export async function searchOrderDetails(
  supabase: SupabaseClient,
  args: SearchOrderDetailsArgs,
  trusted?: PlatformSupportMcpContext | null
): Promise<OrderDetailsSearchResult> {
  const sessionId = resolveTrustedSupportSessionId(trusted);
  if (!sessionId) {
    logInfo("vachat.mcp.denied", {
      tool: args.tool ?? SEARCH_ORDER_DETAILS_TOOL,
      mode: "untrusted_remote",
      reason: "missing_trusted_context",
      requestId: args.requestId ?? trusted?.requestId ?? null,
    });
    return emptyResult(MCP_UNAUTHORIZED);
  }
  const bound = await getBoundSupportOrder(supabase, { sessionId, now: args.now });
  if (!bound.ok) {
    logInfo("vachat.mcp.denied", {
      tool: args.tool ?? SEARCH_ORDER_DETAILS_TOOL,
      mode: "platform_support",
      reason: bound.code,
      requestId: args.requestId ?? trusted?.requestId ?? null,
    });
    const answer =
      bound.code === "REJECTED" ? MCP_ORDER_UNAVAILABLE : bound.message;
    return emptyResult(answer);
  }

  const hit = toHit(bound.order);
  return {
    account: VACHAT_ASSISTANT_ACCOUNT,
    assistant: VACHAT_ASSISTANT_NAME,
    fetched_at: new Date().toISOString(),
    live: true,
    tracking_page: POSTBUS_PUBLIC_TRACK_URL,
    customer_whatsapp: null,
    found: true,
    answer: formatBoundSupportOrderReply(bound.order, args.query ?? ""),
    organizations: [toOrganizationHit(bound.order)],
    results: [hit],
  };
}

export async function searchMerchantOrganization(
  supabase: SupabaseClient,
  args: SearchOrderDetailsArgs,
  trusted?: PlatformSupportMcpContext | null
) {
  return searchOrderDetails(
    supabase,
    {
      ...args,
      tool: args.tool ?? SEARCH_MERCHANT_ORGANIZATION_TOOL,
    },
    trusted
  );
}

export function mcpToolCallResult(result: OrderDetailsSearchResult) {
  return {
    content: [{ type: "text", text: formatOrderDetailsText(result) }],
    structuredContent: result,
    isError: !result.found,
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
  search: (args: SearchOrderDetailsArgs) => Promise<OrderDetailsSearchResult>,
  meta?: { requestId?: string }
): Promise<{ status: number; body: unknown | null }> {
  if (Array.isArray(raw)) {
    const bodies = [];
    for (const item of raw) {
      const handled = await handleMcpRpc(item, search, meta);
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
    if (name !== SEARCH_ORDER_DETAILS_TOOL && name !== SEARCH_MERCHANT_ORGANIZATION_TOOL) {
      return { status: 200, body: rpcError(id, -32601, `Unknown tool: ${name || "(missing)"}`) };
    }
    try {
      const args = parseSearchOrderDetailsArgs(params.arguments ?? params);
      const result = await search({
        ...args,
        requestId: meta?.requestId,
        tool: name,
      });
      return { status: 200, body: rpcResult(id, mcpToolCallResult(result)) };
    } catch (error) {
      const message = error instanceof AppError ? error.message : MCP_UNAUTHORIZED;
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
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
  };
}
