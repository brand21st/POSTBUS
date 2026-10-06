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

export function restDrainConcurrency(bookingCount: number) {
  return bookingCount === 0 ? LABEL_LANE_CONCURRENCY : MIXED_REST_CONCURRENCY;
}
