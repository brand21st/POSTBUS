import type {
  AddressSummary,
  CustomerSummary,
  DashboardKpis,
  DashboardPipeline,
  IntegrationsResponse,
  LineItem,
  Paginated,
  PipelineStage,
  SearchResponse,
  SearchResult,
} from "@/types/api";

export function pickString(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (value) return value;
  }
  return "";
}

export function pickNumber(...values: Array<number | string | null | undefined>) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

export function asList<T>(payload: unknown, keys: string[] = ["items", "results", "data"]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as T[];
  }
  return [];
}

export function asPaginated<T>(payload: unknown, fallbackKeys: string[] = ["items"]): Paginated<T> {
  const record = (payload ?? {}) as Record<string, unknown>;
  const pagination = (record.pagination ?? {}) as Record<string, unknown>;
  return {
    items: asList<T>(payload, [...fallbackKeys, "items", "results"]),
    page: pickNumber(record.page as number, pagination.page as number) ?? 1,
    pageSize:
      pickNumber(record.pageSize as number, record.page_size as number, pagination.pageSize as number) ??
      20,
    total: pickNumber(record.total as number, pagination.total as number) ?? 0,
  };
}

export function orderNumber(order: { orderNumber?: string; order_number?: string; id: string }) {
  return pickString(order.orderNumber, order.order_number, order.id.slice(0, 8));
}

export function createdAt(record: { createdAt?: string; created_at?: string }) {
  return record.createdAt ?? record.created_at ?? null;
}

export function customerName(order: {
  customer?: CustomerSummary | null;
  customerName?: string | null;
}) {
  return pickString(order.customerName, order.customer?.name, "—") || "—";
}

export function addressLine(address?: AddressSummary | null) {
  if (!address) return "—";
  return (
    [address.line1, address.line2, address.city, address.state, address.pincode]
      .filter(Boolean)
      .join(", ") || "—"
  );
}

const ITEM_PREVIEW_LIMIT = 2;
const BLOCKED_PROCESS_STATUSES = new Set([
  "PROCESSING",
  "BOOKED",
  "SHIPPED",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
]);
const BLOCKED_FULFILL_STATUSES = new Set(["BOOKED", "SHIPPED", "IN_TRANSIT", "DELIVERED", "CANCELLED"]);

export function lineItems(order: { lineItems?: LineItem[]; line_items?: LineItem[] }) {
  return order.lineItems ?? order.line_items ?? [];
}

export function itemCount(order: {
  items?: number;
  lineItems?: LineItem[];
  line_items?: LineItem[];
}) {
  if (typeof order.items === "number") return order.items;
  return lineItems(order).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
}

export function itemNamesPreview(order: { lineItems?: LineItem[]; line_items?: LineItem[] }) {
  const items = lineItems(order);
  if (items.length === 0) return "";
  const names = items.map((item) => `${item.title} ×${item.quantity}`);
  const preview = names.slice(0, ITEM_PREVIEW_LIMIT);
  const extra = names.length - preview.length;
  return extra > 0 ? `${preview.join(", ")} +${extra} more` : preview.join(", ");
}

export function itemSummary(order: {
  items?: number;
  lineItems?: LineItem[];
  line_items?: LineItem[];
}) {
  const names = itemNamesPreview(order);
  if (!names) return "—";
  const count = itemCount(order);
  const label = count === 1 ? "1 item" : `${count} items`;
  return `${label} · ${names}`;
}

export function canProcessOrder(order: { status?: string | null }) {
  return !BLOCKED_PROCESS_STATUSES.has((order.status ?? "").toUpperCase());
}

export function canFulfillOrder(order: { status?: string | null }) {
  return !BLOCKED_FULFILL_STATUSES.has((order.status ?? "").toUpperCase());
}

export function canShipOrder(order: { status?: string | null }) {
  return canFulfillOrder(order);
}

export function isWatiConnected(payload?: IntegrationsResponse | null) {
  return (payload?.wati?.status ?? "").toUpperCase() === "CONNECTED";
}

export function isShopifyConnected(payload?: IntegrationsResponse | null) {
  const status = (payload?.shopify?.status ?? "").toUpperCase();
  return status === "CONNECTED" || Boolean(payload?.shopify?.readyToSync);
}

export function canProcessOrderAction(order: { status?: string | null }, extrasConnected = false) {
  const status = (order.status ?? "").toUpperCase();
  if (status === "CANCELLED") return false;
  return extrasConnected || canProcessOrder(order);
}

export function canFulfillOrderAction(order: { status?: string | null }, extrasConnected = false) {
  const status = (order.status ?? "").toUpperCase();
  if (status === "CANCELLED") return false;
  return extrasConnected || canFulfillOrder(order);
}

export function canMarkInTransit(order: { status?: string | null }, extrasConnected = false) {
  if (!extrasConnected) return false;
  const status = (order.status ?? "").toUpperCase();
  return status !== "CANCELLED" && status !== "DELIVERED";
}

export function canMarkDelivered(order: { status?: string | null }, extrasConnected = false) {
  if (!extrasConnected) return false;
  return (order.status ?? "").toUpperCase() !== "CANCELLED";
}

export function orderActionLabel(status?: string | null) {
  switch ((status ?? "").toUpperCase()) {
    case "PROCESSING":
      return "Processing";
    case "BOOKED":
      return "Booked";
    case "SHIPPED":
    case "IN_TRANSIT":
      return "In transit";
    case "DELIVERED":
      return "Delivered";
    case "CANCELLED":
      return "Cancelled";
    case "FAILED":
      return "Failed";
    default:
      return "Ship";
  }
}

export function orderActionButtonClass(status?: string | null) {
  switch ((status ?? "").toUpperCase()) {
    case "PROCESSING":
      return "border-orange-300 bg-orange-500 text-white hover:bg-orange-600 hover:border-orange-400";
    case "BOOKED":
      return "border-amber-300 bg-amber-400 text-amber-950 hover:bg-amber-500 hover:border-amber-400";
    case "SHIPPED":
    case "IN_TRANSIT":
      return "border-indigo-300 bg-indigo-600 text-white hover:bg-indigo-700 hover:border-indigo-400";
    case "DELIVERED":
      return "border-emerald-300 bg-emerald-600 text-white hover:bg-emerald-700 hover:border-emerald-400";
    case "CANCELLED":
      return "border-zinc-300 bg-zinc-200 text-zinc-600 hover:bg-zinc-200";
    case "FAILED":
      return "border-red-300 bg-red-600 text-white hover:bg-red-700 hover:border-red-400";
    default:
      return "";
  }
}

export function kpiValue(source: DashboardKpis | undefined, key: keyof DashboardKpis, fallbackKeys: string[] = []) {
  if (!source) return null;
  const direct = source[key];
  if (typeof direct === "number") return direct;
  if (direct && typeof direct === "object" && !Array.isArray(direct) && "value" in direct) {
    return pickNumber(direct.value);
  }
  const metrics = source.metrics ?? [];
  const wanted = [String(key).toLowerCase(), ...fallbackKeys.map((item) => item.toLowerCase())];
  const match = metrics.find((metric) =>
    wanted.includes((metric.key ?? "").toLowerCase()) || wanted.includes((metric.label ?? "").toLowerCase())
  );
  return pickNumber(match?.value);
}

export function kpiChange(source: DashboardKpis | undefined, key: keyof DashboardKpis) {
  const direct = source?.[key];
  if (direct && typeof direct === "object" && !Array.isArray(direct) && "value" in direct) {
    if (direct.comparisonAvailable === false) return null;
    return pickNumber(direct.change);
  }
  return null;
}

export function pipelineStages(payload?: DashboardPipeline | PipelineStage[] | null): PipelineStage[] {
  if (Array.isArray(payload)) return payload;
  return payload?.stages ?? payload?.items ?? [];
}

export function integrationList(payload?: IntegrationsResponse | null) {
  if (!payload) return [];
  if (payload.items?.length) return payload.items;
  if (payload.integrations?.length) return payload.integrations;
  return [payload.shopify, payload.indiaPost, payload.india_post, payload.wati].filter(Boolean);
}

export function flattenSearch(payload?: SearchResponse | SearchResult[] | null): SearchResult[] {
  if (Array.isArray(payload)) return payload;
  if (!payload) return [];
  if (payload.items?.length) return payload.items;
  if (payload.results?.length) return payload.results;
  return [...(payload.orders ?? []), ...(payload.shipments ?? []), ...(payload.customers ?? [])];
}

export function boolField(
  record: Record<string, unknown> | null | undefined,
  camel: string,
  snake: string,
  fallback = false
) {
  if (!record) return fallback;
  const value = record[camel] ?? record[snake];
  return typeof value === "boolean" ? value : fallback;
}
