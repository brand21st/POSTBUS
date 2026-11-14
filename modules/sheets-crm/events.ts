export const SHEETS_CRM_EVENTS = [
  "customer.signup.completed",
  "workspace.created",
  "workspace.updated",
  "onboarding.updated",
  "india_post.connected",
  "store.connected",
  "subscription.updated",
  "customer.activity.updated",
  "customer.abandoned",
  "customer.reactivated",
] as const;

export type SheetsCrmEventType = (typeof SHEETS_CRM_EVENTS)[number];

export const SHEETS_CRM_ACTIVITY_WINDOW_MS = 6 * 60 * 60 * 1000;
export const SHEETS_CRM_BATCH_LIMIT = 50;
export const SHEETS_CRM_MAX_ATTEMPTS = 5;

export type SheetsCrmThresholds = {
  noWorkspaceHours: number;
  indiaPostHours: number;
  onboardingHours: number;
  inactiveDays: number;
};

export const DEFAULT_SHEETS_CRM_THRESHOLDS: SheetsCrmThresholds = {
  noWorkspaceHours: 24,
  indiaPostHours: 24,
  onboardingHours: 48,
  inactiveDays: 7,
};

export const SHEETS_CRM_LIVE_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "PAUSED", "PAYMENT_FAILED"] as const;

export type SheetsCrmLifecycle = "signup" | "onboarding" | "active" | "abandoned" | "recovered";

export type SheetsCrmSignupSource = "affiliate" | "shopify" | "whatsapp" | "email";

export type SheetsCrmWorkspace = {
  id: string;
  name: string;
  createdAt: string;
  accountStatus: string;
  indiaPostConnected: boolean;
  shopifyConnected: boolean;
  wooConnected: boolean;
  planName: string;
  subscriptionStatus: string;
};

export type SheetsCrmSnapshot = {
  customerId: string;
  fullName: string;
  email: string;
  phone: string;
  signupAt: string;
  signupSource: SheetsCrmSignupSource;
  lastActiveAt: string | null;
  workspaces: SheetsCrmWorkspace[];
};

export type SheetsCrmClassification = {
  lifecycle: SheetsCrmLifecycle;
  abandonReason: string | null;
  lastCompletedStep: string;
  leadStatus: "" | "Open" | "Recovered";
};

export function openDedupeKey(customerId: string) {
  return `open:${customerId}`;
}

export function closedDedupeKey(eventId: string) {
  return `closed:${eventId}`;
}

export function activitySyncDue(lastEnqueuedAt: string | null | undefined, now: number, windowMs = SHEETS_CRM_ACTIVITY_WINDOW_MS) {
  if (!lastEnqueuedAt) return true;
  const then = new Date(lastEnqueuedAt).getTime();
  if (!Number.isFinite(then)) return true;
  return now - then >= windowMs;
}
