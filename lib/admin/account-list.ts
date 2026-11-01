export const ADMIN_ACCOUNT_PAGE_SIZE = 25;
export const ADMIN_ACCOUNT_PAGE_SIZE_MAX = 100;
export const ADMIN_ACCOUNT_STATUSES = ["ACTIVE", "BLOCKED", "SUSPENDED", "HOLD", "DISABLED"] as const;

export type AdminAccountTab = "workspaces" | "signups" | "abandoned";
export type AdminAccountStatus = (typeof ADMIN_ACCOUNT_STATUSES)[number];

export function parseAdminAccountListParams(search: {
  get(name: string): string | null;
}) {
  const rawTab = search.get("tab");
  const tab = rawTab === "signups" ? "signups" : rawTab === "abandoned" ? "abandoned" : "workspaces";
  const rawPage = Number(search.get("page") ?? 1);
  const rawSize = Number(search.get("pageSize") ?? ADMIN_ACCOUNT_PAGE_SIZE);
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
  const pageSize = Number.isFinite(rawSize)
    ? Math.min(ADMIN_ACCOUNT_PAGE_SIZE_MAX, Math.max(10, Math.floor(rawSize)))
    : ADMIN_ACCOUNT_PAGE_SIZE;
  const statusRaw = (search.get("status") ?? "").toUpperCase();
  const status = ADMIN_ACCOUNT_STATUSES.includes(statusRaw as AdminAccountStatus)
    ? (statusRaw as AdminAccountStatus)
    : "";
  return { tab: tab as AdminAccountTab, page, pageSize, status };
}

export function listPageRange(page: number, pageSize: number, total: number) {
  const pageCount = Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const from = (safePage - 1) * pageSize;
  const to = from + pageSize - 1;
  return { page: safePage, pageCount, from, to, total };
}
