import { JOB_TYPES, type JobType } from "@/types/domain";

export const LABEL_LANE_CONCURRENCY = 4;
export const MIXED_REST_CONCURRENCY = 2;

const JOB_TYPE_SET = new Set<string>(JOB_TYPES);

export const BOOKING_JOB_TYPES: JobType[] = ["shipment-booking"];
export const LABEL_JOB_TYPES: JobType[] = ["label-generation"];
export const OTHER_JOB_TYPES: JobType[] = JOB_TYPES.filter(
  (type) => type !== "shipment-booking" && type !== "label-generation"
);

export function parseJobTypes(raw?: string | null): JobType[] | undefined {
  if (raw == null) return undefined;
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return undefined;
  const unknown = parts.filter((part) => !JOB_TYPE_SET.has(part));
  if (unknown.length) {
    throw new Error(`Unknown job type: ${unknown.join(", ")}`);
  }
  return [...new Set(parts)] as JobType[];
}

export function drainLaneName(jobTypes?: string[] | null) {
  if (!jobTypes?.length) return "all";
  if (jobTypes.length === 1 && jobTypes[0] === "shipment-booking") return "booking";
  if (jobTypes.length === 1 && jobTypes[0] === "label-generation") return "label";
  return "other";
}

const WOO_JOB_TYPES = new Set(["woocommerce-sync", "woocommerce-tracking"]);
/** Lanes that already run every minute in production. WooCommerce rides along with these. */
const WOO_SIDE_TRIGGERS = new Set(["tracking-sync", "shopify-sync", "webhook-processing", "shopify-fulfillment"]);

/**
 * WooCommerce jobs stay off the main claim. That claim takes the oldest rows, and a backlog of
 * store events would block tracking. A separate newest-first batch runs when this lane already
 * includes WooCommerce or one of the other-lane jobs production actually drains.
 */
export function wooCommerceDrainPlan(jobTypes?: readonly string[] | null): {
  primary: string[] | undefined;
  skipPrimary: boolean;
  woo: boolean;
} {
  if (!jobTypes?.length) return { primary: undefined, skipPrimary: false, woo: false };
  const primary = jobTypes.filter((type) => !WOO_JOB_TYPES.has(type));
  const woo = jobTypes.some((type) => WOO_JOB_TYPES.has(type) || WOO_SIDE_TRIGGERS.has(type));
  if (!primary.length) return { primary: undefined, skipPrimary: true, woo: true };
  return { primary, skipPrimary: false, woo };
}

export function restDrainConcurrency(bookingCount: number) {
  return bookingCount === 0 ? LABEL_LANE_CONCURRENCY : MIXED_REST_CONCURRENCY;
}
