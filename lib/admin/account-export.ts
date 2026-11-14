import type { SheetCell } from "@/lib/xlsx/write";

export const WORKSPACE_EXPORT_HEADERS = [
  "Name",
  "Slug",
  "Status",
  "Plan",
  "Subscription status",
  "Billing cycle",
  "Amount INR",
  "Owner name",
  "Owner email",
  "Owner WhatsApp",
  "Last active",
  "Created",
  "Organization ID",
] as const;

export const ABANDONED_EXPORT_HEADERS = [
  "Name",
  "Email",
  "WhatsApp",
  "PIN",
  "City",
  "Created",
  "User ID",
] as const;

export type AccountExportTab = "workspaces" | "abandoned";

export type WorkspaceExportSource = {
  id: string;
  name: string | null;
  slug: string | null;
  account_status: string | null;
  created_at: string | null;
  lastActiveAt?: string | null;
  planName?: string | null;
  subscriptionStatus?: string | null;
  billingCycle?: string | null;
  amountPaise?: number | null;
  ownerName?: string | null;
  ownerEmail?: string | null;
  ownerWhatsapp?: string | null;
};

export type AbandonedExportSource = {
  id: string;
  full_name: string | null;
  email: string | null;
  whatsapp_number: string | null;
  pincode: string | null;
  city: string | null;
  created_at: string | null;
};

function cell(value: string | number | null | undefined): SheetCell {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  return value;
}

function rupees(paise: number | null | undefined): SheetCell {
  if (paise == null || !Number.isFinite(paise)) return "";
  return Math.round(paise) / 100;
}

export function workspaceExportRows(rows: WorkspaceExportSource[]): SheetCell[][] {
  return [
    [...WORKSPACE_EXPORT_HEADERS],
    ...rows.map((row) => [
      cell(row.name),
      cell(row.slug),
      cell(row.account_status),
      cell(row.planName),
      cell(row.subscriptionStatus),
      cell(row.billingCycle),
      rupees(row.amountPaise),
      cell(row.ownerName),
      cell(row.ownerEmail),
      cell(row.ownerWhatsapp),
      cell(row.lastActiveAt),
      cell(row.created_at),
      row.id,
    ]),
  ];
}

export function abandonedExportRows(rows: AbandonedExportSource[]): SheetCell[][] {
  return [
    [...ABANDONED_EXPORT_HEADERS],
    ...rows.map((row) => [
      cell(row.full_name),
      cell(row.email),
      cell(row.whatsapp_number),
      cell(row.pincode),
      cell(row.city),
      cell(row.created_at),
      row.id,
    ]),
  ];
}

export function parseAccountExportTab(raw: string | null): AccountExportTab {
  if (raw === "workspaces" || raw === "abandoned") return raw;
  throw new Error("Export is available for workspaces and abandoned signups only.");
}

export function accountExportFilename(tab: AccountExportTab, date: string) {
  const prefix = tab === "abandoned" ? "postbus-abandoned" : "postbus-workspaces";
  return `${prefix}-${date}.xlsx`;
}

export function accountExportDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
