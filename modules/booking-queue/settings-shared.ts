/** Bulk Booking settings constants and types, safe to import from client components. */

/** Sources whose imports can enroll orders by themselves today. Others are added by a person. */
export const AUTO_ENROLL_SOURCES = ["SHOPIFY", "WOOCOMMERCE"] as const;
export type AutoEnrollSource = (typeof AUTO_ENROLL_SOURCES)[number];

export const BATCH_THRESHOLD_PRESETS = [50, 100, 500, 1000, 5000] as const;
export const MAX_WAIT_PRESETS = [15, 30, 60, 120, 240, 720, 1440] as const;
export const BATCH_THRESHOLD_RANGE = { min: 1, max: 5000 } as const;
export const MAX_WAIT_RANGE = { min: 5, max: 1440 } as const;

export type BookingAutomationSettings = {
  mode: "MANUAL" | "AUTOMATIC";
  enrollmentSources: AutoEnrollSource[];
  batchThreshold: number;
  maxWaitMinutes: number | null;
  paused: boolean;
  pausedAt: string | null;
  version: number;
  /** Whether this workspace may switch to AUTOMATIC (rollout gate). */
  automationAvailable: boolean;
  lastError: string | null;
  lastDispatchAt: string | null;
};
