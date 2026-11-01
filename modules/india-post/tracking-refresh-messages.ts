export const TRACKING_REFRESH_MESSAGES = {
  noNewEvents: "No new tracking updates available.",
  unauthorized: "India Post tracking access is not authorized.",
  unavailable: "Unable to refresh tracking. Showing saved information.",
  updated: "Tracking updated.",
  cached: "Showing latest saved tracking.",
} as const;

export type TrackingRefreshKind = "updated" | "no_new_events" | "cached" | "unauthorized" | "unavailable";

export function trackingRefreshKind(input: {
  httpStatus?: number | null;
  skippedFetch?: boolean;
  eventsInserted?: number;
  unauthorized?: boolean;
  unavailable?: boolean;
}): TrackingRefreshKind {
  if (input.unauthorized || input.httpStatus === 403) return "unauthorized";
  if (input.unavailable || input.httpStatus === 401 || (input.httpStatus != null && input.httpStatus >= 500)) {
    return "unavailable";
  }
  if (input.skippedFetch) return "cached";
  if ((input.eventsInserted ?? 0) > 0) return "updated";
  return "no_new_events";
}

export function trackingRefreshMessage(input: Parameters<typeof trackingRefreshKind>[0]) {
  const kind = trackingRefreshKind(input);
  if (kind === "updated") return TRACKING_REFRESH_MESSAGES.updated;
  if (kind === "cached") return TRACKING_REFRESH_MESSAGES.cached;
  if (kind === "unauthorized") return TRACKING_REFRESH_MESSAGES.unauthorized;
  if (kind === "unavailable") return TRACKING_REFRESH_MESSAGES.unavailable;
  return TRACKING_REFRESH_MESSAGES.noNewEvents;
}
