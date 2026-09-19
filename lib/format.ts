import { format, formatDistanceToNow, isValid, parseISO } from "date-fns";

export function formatCurrency(value: number | string | null | undefined, currency = "INR") {
  const amount = typeof value === "string" ? Number(value) : value;
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(value: number | string | null | undefined) {
  const amount = typeof value === "string" ? Number(value) : value;
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat("en-IN").format(amount);
}

export function formatDate(value: string | Date | null | undefined, withTime = false) {
  if (!value) return "—";
  const date = typeof value === "string" ? parseISO(value) : value;
  if (!isValid(date)) return "—";
  return format(date, withTime ? "d MMM yyyy, h:mm a" : "d MMM yyyy");
}

export function formatRelative(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? parseISO(value) : value;
  if (!isValid(date)) return "—";
  return formatDistanceToNow(date, { addSuffix: true });
}

export function titleCase(value: string | null | undefined) {
  if (!value) return "—";
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function initials(name: string | null | undefined, fallback = "PB") {
  if (!name?.trim()) return fallback;
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || fallback;
}

export function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number" && Number.isNaN(value)) return "—";
  return String(value);
}
