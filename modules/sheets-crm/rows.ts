import { createHash } from "node:crypto";
import {
  daysInactive,
  isActiveCustomer,
  primaryWorkspace,
} from "@/modules/sheets-crm/abandonment";
import type { SheetsCrmClassification, SheetsCrmSnapshot, SheetsCrmWorkspace } from "@/modules/sheets-crm/events";

export type SheetRow = Record<string, string>;

export type SheetsCrmSheetPayload = {
  signup: SheetRow;
  workspaces: SheetRow[];
  abandoned: SheetRow | null;
  active: SheetRow | null;
  clearActive: boolean;
};

const FORMULA_PREFIX = /^[=+\-@]/;

export function sheetCell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

function row(entries: Record<string, string | number | null | undefined>): SheetRow {
  const out: SheetRow = {};
  for (const [key, value] of Object.entries(entries)) out[key] = sheetCell(value);
  return out;
}

export function trialStatusLabel(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "TRIAL") return "Trial";
  if (normalized === "ACTIVE") return "Subscribed";
  if (normalized === "EXPIRED") return "Expired";
  if (normalized === "CANCELLED") return "Cancelled";
  if (!normalized) return "None";
  return status;
}

export function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

export function storeIntegrationStatus(workspace: SheetsCrmWorkspace | null) {
  if (!workspace) return "Not connected";
  const parts: string[] = [];
  if (workspace.shopifyConnected) parts.push("Shopify");
  if (workspace.wooConnected) parts.push("WooCommerce");
  return parts.length ? parts.join(", ") : "Not connected";
}

export function onboardingLabel(lifecycle: SheetsCrmClassification["lifecycle"]) {
  if (lifecycle === "signup") return "Signup";
  if (lifecycle === "onboarding") return "Onboarding";
  if (lifecycle === "active") return "Active";
  if (lifecycle === "abandoned") return "Abandoned";
  return "Recovered";
}

function workspaceRow(snapshot: SheetsCrmSnapshot, workspace: SheetsCrmWorkspace, nowIso: string): SheetRow {
  return row({
    "Workspace ID": workspace.id,
    "Customer ID": snapshot.customerId,
    "Owner Name": snapshot.fullName,
    Email: snapshot.email,
    "Phone Number": snapshot.phone,
    "Business Name": workspace.name,
    "Workspace Created Date": workspace.createdAt,
    "India Post Connected": yesNo(workspace.indiaPostConnected),
    "Shopify Connected": yesNo(workspace.shopifyConnected),
    "WooCommerce Connected": yesNo(workspace.wooConnected),
    "Subscription Plan": workspace.planName || "None",
    "Trial Status": trialStatusLabel(workspace.subscriptionStatus),
    "Workspace Status": workspace.accountStatus || "ACTIVE",
    "Last Activity": snapshot.lastActiveAt || nowIso,
  });
}

export function buildSheetPayload(
  snapshot: SheetsCrmSnapshot,
  classification: SheetsCrmClassification,
  now: number,
  onboardingCompletedAt: string | null
): SheetsCrmSheetPayload {
  const nowIso = new Date(now).toISOString();
  const primary = primaryWorkspace(snapshot);
  const showAbandoned =
    classification.lifecycle === "abandoned" ||
    classification.lifecycle === "recovered" ||
    classification.leadStatus === "Recovered";
  const showActive = classification.lifecycle === "active" || classification.lifecycle === "recovered";
  const activeWorkspace = snapshot.workspaces.find((workspace) => workspace.indiaPostConnected) ?? primary;
  const signup = row({
    "Customer ID": snapshot.customerId,
    "Full Name": snapshot.fullName,
    "Email Address": snapshot.email,
    "Phone Number": snapshot.phone,
    "Signup Date & Time": snapshot.signupAt,
    "Signup Source": snapshot.signupSource,
    "Workspace ID": primary?.id ?? "",
    "Workspace Name": primary?.name ?? "",
    "Account Status": primary?.accountStatus || "NO_WORKSPACE",
    "Onboarding Status": onboardingLabel(classification.lifecycle),
    "Last Active Date": snapshot.lastActiveAt ?? "",
    "Last Updated": nowIso,
  });
  const abandoned = showAbandoned
    ? row({
        "Customer ID": snapshot.customerId,
        "Customer Name": snapshot.fullName,
        "Phone Number": snapshot.phone,
        Email: snapshot.email,
        "Signup Date": snapshot.signupAt,
        "Workspace Name": primary?.name ?? "",
        "Last Completed Onboarding Step": classification.lastCompletedStep,
        "India Post Connection Status": yesNo(Boolean(primary?.indiaPostConnected)),
        "Store Integration Status": storeIntegrationStatus(primary),
        "Last Activity": snapshot.lastActiveAt ?? "",
        "Abandonment Reason": classification.abandonReason ?? "",
        "Days Inactive": daysInactive(snapshot, now),
        "Lead Status": classification.leadStatus || "Open",
        "Last Updated": nowIso,
      })
    : null;
  const active =
    showActive && activeWorkspace
      ? row({
          "Customer ID": snapshot.customerId,
          "Full Name": snapshot.fullName,
          "Email Address": snapshot.email,
          "Phone Number": snapshot.phone,
          "Workspace ID": activeWorkspace.id,
          "Workspace Name": activeWorkspace.name,
          "Subscription Plan": activeWorkspace.planName || "None",
          "Trial Status": trialStatusLabel(activeWorkspace.subscriptionStatus),
          "India Post Connected": yesNo(activeWorkspace.indiaPostConnected),
          "Shopify Connected": yesNo(activeWorkspace.shopifyConnected),
          "WooCommerce Connected": yesNo(activeWorkspace.wooConnected),
          "Last Activity": snapshot.lastActiveAt ?? "",
          "Onboarding Completed At": onboardingCompletedAt || nowIso,
          "Account Status": activeWorkspace.accountStatus || "ACTIVE",
        })
      : null;
  return {
    signup,
    workspaces: snapshot.workspaces.map((workspace) => workspaceRow(snapshot, workspace, nowIso)),
    abandoned,
    active,
    clearActive: !isActiveCustomer(snapshot),
  };
}

export function projectionHash(payload: SheetsCrmSheetPayload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function redactCrmError(message: string) {
  return message.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]").slice(0, 300);
}
