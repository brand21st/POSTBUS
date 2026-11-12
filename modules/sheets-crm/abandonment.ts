import {
  SHEETS_CRM_LIVE_STATUSES,
  type SheetsCrmClassification,
  type SheetsCrmLifecycle,
  type SheetsCrmSnapshot,
  type SheetsCrmThresholds,
  type SheetsCrmWorkspace,
} from "@/modules/sheets-crm/events";

const LIVE = new Set<string>(SHEETS_CRM_LIVE_STATUSES);

export function primaryWorkspace(snapshot: SheetsCrmSnapshot): SheetsCrmWorkspace | null {
  if (!snapshot.workspaces.length) return null;
  return [...snapshot.workspaces].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;
}

export function workspaceIsActive(workspace: SheetsCrmWorkspace) {
  return workspace.indiaPostConnected && LIVE.has(workspace.subscriptionStatus.toUpperCase());
}

export function isActiveCustomer(snapshot: SheetsCrmSnapshot) {
  return snapshot.workspaces.some(workspaceIsActive);
}

export function hoursSince(iso: string, now: number) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return (now - then) / 3_600_000;
}

export function inactiveAnchor(snapshot: SheetsCrmSnapshot) {
  return snapshot.lastActiveAt || snapshot.signupAt;
}

export function daysInactive(snapshot: SheetsCrmSnapshot, now: number) {
  const then = new Date(inactiveAnchor(snapshot)).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

export function lastCompletedStep(snapshot: SheetsCrmSnapshot) {
  if (isActiveCustomer(snapshot)) return "onboarding_complete";
  if (snapshot.workspaces.some((workspace) => workspace.shopifyConnected || workspace.wooConnected)) {
    return "store_connected";
  }
  if (snapshot.workspaces.some((workspace) => workspace.indiaPostConnected)) return "india_post_connected";
  if (snapshot.workspaces.length) return "workspace_created";
  return "signed_up";
}

/** First matching rule wins. Active customers are never abandoned. */
export function abandonReason(snapshot: SheetsCrmSnapshot, thresholds: SheetsCrmThresholds, now: number) {
  if (isActiveCustomer(snapshot)) return null;
  const ageHours = hoursSince(snapshot.signupAt, now);
  const primary = primaryWorkspace(snapshot);
  if (!primary && ageHours >= thresholds.noWorkspaceHours) {
    return "Signup completed but no workspace was created within the threshold";
  }
  if (primary && !primary.indiaPostConnected) {
    const sinceWorkspace = hoursSince(primary.createdAt, now);
    if (sinceWorkspace >= thresholds.indiaPostHours) {
      return "Workspace created but India Post is not connected within the threshold";
    }
  }
  if (primary && primary.indiaPostConnected && ageHours >= thresholds.onboardingHours) {
    return "Onboarding started but was not completed within the threshold";
  }
  const status = (primary?.subscriptionStatus ?? "").toUpperCase();
  if (status === "EXPIRED" || status === "CANCELLED") {
    return "Trial ended without an active subscription";
  }
  if (daysInactive(snapshot, now) >= thresholds.inactiveDays) {
    return "No meaningful activity within the threshold after signup";
  }
  return null;
}

export function classifyCustomer(
  snapshot: SheetsCrmSnapshot,
  thresholds: SheetsCrmThresholds,
  now: number,
  previous: SheetsCrmLifecycle | null
): SheetsCrmClassification {
  const step = lastCompletedStep(snapshot);
  if (isActiveCustomer(snapshot)) {
    const recovered = previous === "abandoned" || previous === "recovered";
    return {
      lifecycle: recovered ? "recovered" : "active",
      abandonReason: null,
      lastCompletedStep: step,
      leadStatus: recovered ? "Recovered" : "",
    };
  }
  const reason = abandonReason(snapshot, thresholds, now);
  if (reason) {
    return {
      lifecycle: "abandoned",
      abandonReason: reason,
      lastCompletedStep: step,
      leadStatus: "Open",
    };
  }
  return {
    lifecycle: snapshot.workspaces.length ? "onboarding" : "signup",
    abandonReason: null,
    lastCompletedStep: step,
    leadStatus: "",
  };
}

export function lifecycleChanged(previous: SheetsCrmLifecycle | null, next: SheetsCrmClassification) {
  if (!previous) return next.lifecycle === "abandoned";
  if (previous === next.lifecycle) return false;
  return next.lifecycle === "abandoned" || next.lifecycle === "recovered" || previous === "abandoned";
}
