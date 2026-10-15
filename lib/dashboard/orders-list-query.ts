export function parseOrdersPageParam(value: string | null | undefined): number {
  if (value == null || value === "") return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

export function patchOrdersListSearchParams(
  current: URLSearchParams | string,
  patch: { page?: number; q?: string | null }
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
