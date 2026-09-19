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

export function lineItems(order: { lineItems?: LineItem[]; line_items?: LineItem[] }) {
  return order.lineItems ?? order.line_items ?? [];
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
  return [payload.shopify, payload.indiaPost, payload.india_post].filter(Boolean);
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
