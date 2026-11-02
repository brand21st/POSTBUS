import { ORDER_LIST_SORTS, type OrderListSort } from "@/modules/orders/schema";

export type OrdersNumberSort = "order_number" | "-order_number" | undefined;

export function parseOrdersPageParam(value: string | null | undefined): number {
  if (value == null || value === "") return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

export function parseOrdersSortParam(value: string | null | undefined): OrderListSort | undefined {
  if (!value) return undefined;
  return (ORDER_LIST_SORTS as readonly string[]).includes(value) ? (value as OrderListSort) : undefined;
}

export function nextOrdersNumberSort(current: OrdersNumberSort): OrdersNumberSort {
  if (current === "-order_number") return "order_number";
  if (current === "order_number") return undefined;
  return "-order_number";
}

export function ordersNumberSortState(sort: OrderListSort | undefined): "none" | "asc" | "desc" {
  if (sort === "order_number") return "asc";
  if (sort === "-order_number") return "desc";
  return "none";
}

export function patchOrdersListSearchParams(
  current: URLSearchParams | string,
  patch: { page?: number; q?: string | null; sort?: OrderListSort | null }
): string {
  const next = new URLSearchParams(typeof current === "string" ? current : current.toString());
  if (patch.q !== undefined) {
    const q = patch.q?.trim() ?? "";
    if (q) next.set("q", q);
    else next.delete("q");
  }
  if (patch.page !== undefined) {
    if (patch.page <= 1) next.delete("page");
    else next.set("page", String(patch.page));
  }
  if (patch.sort !== undefined) {
    if (patch.sort) next.set("sort", patch.sort);
    else next.delete("sort");
  }
  return next.toString();
}

export function ordersListHref(params: string): string {
  return params ? `/dashboard/orders?${params}` : "/dashboard/orders";
}

export function committedSearchChanged(previous: string, next: string): boolean {
  return previous.trim() !== next.trim();
}

export function selectionAfterFilterChange(): string[] {
  return [];
}

export function selectionAfterPageChange(selected: string[]): string[] {
  return selected;
}
