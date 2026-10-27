import {
  normalizeLabelDatePreset,
  parseCalendarDate,
  type LabelDatePreset,
} from "@/modules/labels/date-range";
import { parseOrdersPageParam } from "@/lib/dashboard/orders-list-query";

export type LabelKindUrlFilter = "ALL" | "COMPLETE" | "INCOMPLETE";

export type LabelsListQueryState = {
  page: number;
  kind: LabelKindUrlFilter;
  q: string;
  date: LabelDatePreset;
  on: string | null;
  from: string | null;
  to: string | null;
};

export function parseLabelKindParam(value?: string | null): LabelKindUrlFilter {
  const kind = String(value || "ALL").toUpperCase();
  if (kind === "COMPLETE" || kind === "INCOMPLETE") return kind;
  return "ALL";
}

export function parseLabelsListSearchParams(params: URLSearchParams | string): LabelsListQueryState {
  const search = typeof params === "string" ? new URLSearchParams(params) : params;
  const date = normalizeLabelDatePreset(search.get("date"));
  const on = parseCalendarDate(search.get("on"));
  const from = parseCalendarDate(search.get("from"));
  const to = parseCalendarDate(search.get("to"));
  return {
    page: parseOrdersPageParam(search.get("page")),
    kind: parseLabelKindParam(search.get("kind")),
    q: (search.get("q") ?? "").trim(),
    date: date === "custom" && !on ? "all" : date === "range" && (!from || !to) ? "all" : date,
    on: date === "custom" ? on : null,
    from: date === "range" && from && to ? (from <= to ? from : to) : date === "range" ? from : null,
    to: date === "range" && from && to ? (from <= to ? to : from) : date === "range" ? to : null,
  };
}

export function serializeLabelsListSearchParams(state: LabelsListQueryState): string {
  const next = new URLSearchParams();
  if (state.kind !== "ALL") next.set("kind", state.kind);
  if (state.q) next.set("q", state.q);
  if (state.date !== "all") next.set("date", state.date);
  if (state.date === "custom" && state.on) next.set("on", state.on);
  if (state.date === "range" && state.from && state.to) {
    next.set("from", state.from);
    next.set("to", state.to);
  }
  if (state.page > 1) next.set("page", String(state.page));
  return next.toString();
}

export function labelsListHref(params: string) {
  return params ? `/dashboard/labels?${params}` : "/dashboard/labels";
}

export function selectedLabelsCaption(count: number) {
  return count === 1 ? "1 Label Selected" : `${count} Labels Selected`;
}

export function labelsApiSearchParams(state: LabelsListQueryState, pageSize = 20) {
  const params = new URLSearchParams({ page: String(state.page), pageSize: String(pageSize) });
  if (state.kind !== "ALL") params.set("kind", state.kind);
  if (state.q) params.set("q", state.q);
  if (state.date !== "all") params.set("date", state.date);
  if (state.date === "custom" && state.on) params.set("on", state.on);
  if (state.date === "range" && state.from && state.to) {
    params.set("from", state.from);
    params.set("to", state.to);
  }
  return params;
}
