import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyProviderError, type ClassifiedError } from "@/lib/jobs/retry";
import { isAmbiguousCeptOutcome } from "@/modules/india-post/booking-failure-state";
import { shipmentBarcode } from "@/modules/india-post/booking-idempotency";
import { readCeptSubmitIntentAt } from "@/modules/india-post/booking-intent";
import { indiaPostDimensionLimits, isParcelArticle } from "@/modules/india-post/article-validator";
import { indiaPostMobile } from "@/modules/india-post/endpoints";
import { smartAutoBookingRetryEnabled } from "@/modules/india-post/booking-recovery";
import {
  evaluateBookingRetryEligibility,
  evaluateOrderBookingEligibility,
  isHistoricalUnauthoredFirstBooking,
  NEVER_SUBMITTED_CODES,
  shipmentOutcomeIsUncertain,
  type BookingRetryJob,
  type BookingRetryOrder,
  type BookingRetryShipment,
} from "@/modules/india-post/booking-retry-eligibility";
import { INDIA_POST_ADDRESS_LINE_MAX } from "@/modules/india-post/spec";
import { INDIA_POST_WEIGHT_MAX_G, INDIA_POST_WEIGHT_MIN_G, toIndiaPostPhysicalWeightGrams } from "@/modules/india-post/weight";
import { enqueueShipmentBookingJob, loadLatestShipmentBookingJob } from "@/modules/jobs/shipment-booking-job";
import {
  shippingAddressBookingBlock,
  type StoredShippingFields,
} from "@/modules/shopify/shipping-contact";
import { logInfo } from "@/lib/logger";

export const SMART_AUTO_RETRY_DELAYS_MS = [
  2 * 60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
] as const;

export const SMART_AUTO_RETRY_DEFAULT_MAX_ATTEMPTS = 5;
export const HISTORICAL_JOB_HOLD_AT = "2099-01-01T00:00:00.000Z";
export const SMART_AUTO_RETRY_METADATA_KEY = "smartAutoRetry";

export const SMART_AUTO_RETRY_CLASSES = [
  "SAFE_TRANSIENT_FAILURE",
  "VALIDATION_FAILURE",
  "CEPT_OUTCOME_UNKNOWN",
  "PERMANENT_FAILURE",
] as const;

export type SmartAutoRetryClass = (typeof SMART_AUTO_RETRY_CLASSES)[number];

export const SMART_AUTO_RETRY_MERCHANT_STATES = [
  "AUTO_RETRY_SCHEDULED",
  "RETRYING_BOOKING",
  "WAITING_FOR_ADDRESS_CORRECTION",
  "WAITING_FOR_WEIGHT_CORRECTION",
  "WAITING_FOR_CORRECTION",
  "RECOVERY_REQUIRED",
  "BOOKING_FAILED",
  "BOOKED_SUCCESSFULLY",
  "MANUAL_REVIEW",
] as const;

export type SmartAutoRetryMerchantState = (typeof SMART_AUTO_RETRY_MERCHANT_STATES)[number];

export const SMART_AUTO_RETRY_MERCHANT_LABELS: Record<SmartAutoRetryMerchantState, string> = {
  AUTO_RETRY_SCHEDULED: "AUTO RETRY SCHEDULED",
  RETRYING_BOOKING: "RETRYING BOOKING",
  WAITING_FOR_ADDRESS_CORRECTION: "WAITING FOR ADDRESS CORRECTION",
  WAITING_FOR_WEIGHT_CORRECTION: "WAITING FOR WEIGHT CORRECTION",
  WAITING_FOR_CORRECTION: "WAITING FOR CORRECTION",
  RECOVERY_REQUIRED: "RECOVERY REQUIRED",
  BOOKING_FAILED: "BOOKING FAILED",
  BOOKED_SUCCESSFULLY: "BOOKED SUCCESSFULLY",
  MANUAL_REVIEW: "MANUAL REVIEW",
};

export type SmartAutoRetryCorrectionKind = "address" | "weight" | "dimensions" | "contact" | null;

export type SmartAutoRetryOrgOverrides = {
  enabled?: boolean;
  maxAttempts?: number;
  delayMs?: number[];
};

export type SmartAutoRetrySnapshot = {
  class: SmartAutoRetryClass | null;
  merchantState: SmartAutoRetryMerchantState;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  reason: string;
  errorCode: string | null;
  correctionKind: SmartAutoRetryCorrectionKind;
  canEditShipment: boolean;
  updatedAt: string;
};

const VALIDATION_CODES = new Set([
  "INVALID_PINCODE",
  "INVALID_ADDRESS",
  "INVALID_WEIGHT",
  "INVALID_DIMENSIONS",
  "MISSING_MANDATORY_FIELD",
  "VALIDATION_ERROR",
]);

const ADDRESS_CODES = new Set(["INVALID_PINCODE", "INVALID_ADDRESS"]);

const PERMANENT_CODES = new Set([
  "INVALID_CONTRACT",
  "INVALID_BARCODE",
  "PERMANENT_AUTH_ERROR",
  "SHOPIFY_FULFILLMENT_BLOCKED",
  "BILLING_LIMIT",
  "CEPT_DUPLICATE",
  "BOOKING_REVIEW_REQUIRED",
]);

const PIN = /^\d{6}$/;
const INDIA_COUNTRY = new Set(["IN", "IND", "INDIA", "91"]);

export { smartAutoBookingRetryEnabled };

export function parsePositiveInt(value: string | undefined | null, fallback: number, max = 10) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) return fallback;
  return parsed;
}

export function smartAutoRetryMaxAttempts(org?: SmartAutoRetryOrgOverrides | null) {
  const envMax = parsePositiveInt(process.env.SMART_AUTO_BOOKING_RETRY_MAX_ATTEMPTS, SMART_AUTO_RETRY_DEFAULT_MAX_ATTEMPTS);
  if (org?.maxAttempts != null) {
    const orgMax = Math.floor(org.maxAttempts);
    if (Number.isInteger(orgMax) && orgMax >= 1) return Math.min(orgMax, envMax);
  }
  return envMax;
}

export function smartAutoRetryDelaysMs(org?: SmartAutoRetryOrgOverrides | null): number[] {
  if (org?.delayMs?.length) {
    const cleaned = org.delayMs.filter((ms) => Number.isFinite(ms) && ms >= 30_000);
    if (cleaned.length) return cleaned;
  }
  const raw = process.env.SMART_AUTO_BOOKING_RETRY_DELAYS_MS;
  if (raw && raw.trim()) {
    const parsed = raw
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((ms) => Number.isInteger(ms) && ms >= 30_000);
    if (parsed.length) return parsed;
  }
  return [...SMART_AUTO_RETRY_DELAYS_MS];
}

/**
 * Global flag is fail-closed. An organization may disable Smart Auto Retry, but
 * cannot enable it when the environment flag is off.
 */
export function resolveSmartAutoRetryPolicy(org?: SmartAutoRetryOrgOverrides | null) {
  const globallyEnabled = smartAutoBookingRetryEnabled();
  return {
    enabled: globallyEnabled && org?.enabled !== false,
    maxAttempts: smartAutoRetryMaxAttempts(org),
    delayMs: smartAutoRetryDelaysMs(org),
  };
}

export function smartAutoRetryDelayForAttempt(
  attemptCount: number,
  delays = smartAutoRetryDelaysMs(),
  random = Math.random
) {
  const index = Math.min(Math.max(attemptCount - 1, 0), delays.length - 1);
  const base = delays[index] ?? SMART_AUTO_RETRY_DELAYS_MS[SMART_AUTO_RETRY_DELAYS_MS.length - 1];
  const jitter = Math.floor(random() * 15_000);
  return base + jitter;
}

/** Parked 32 historical jobs use 2099-01-01Z. Never treat those as due. */
export function isParkedHistoricalBookingJob(job?: { next_attempt_at?: string | null; nextAttemptAt?: string | null } | null) {
  const raw = job?.nextAttemptAt ?? job?.next_attempt_at;
  if (!raw) return false;
  const ms = Date.parse(String(raw));
  if (!Number.isFinite(ms)) return false;
  return ms >= Date.parse(HISTORICAL_JOB_HOLD_AT);
}

/** Automatic claim/drain may run a job only when next_attempt_at is due. Invalid timestamps fail closed. */
export function isJobDueForAutomaticClaim(
  job?: { next_attempt_at?: string | null; nextAttemptAt?: string | null } | null,
  now = Date.now()
) {
  const raw = job?.nextAttemptAt ?? job?.next_attempt_at;
  if (!raw) return true;
  const ms = Date.parse(String(raw));
  if (!Number.isFinite(ms)) return false;
  return ms <= now;
}

export function parkedHistoricalJobReleaseStatus(job?: {
  attempt_count?: number | null;
  attemptCount?: number | null;
  last_error_code?: string | null;
} | null) {
  const attempts = job?.attemptCount ?? job?.attempt_count ?? 0;
  if (attempts > 0 || String(job?.last_error_code ?? "").trim()) return "RETRYING" as const;
  return "QUEUED" as const;
}

/**
 * If a drain/RPC already flipped a parked job to RUNNING, put the hold back.
 * Does not touch shipments, barcodes, or error evidence.
 * Only matches RUNNING so a concurrent merchant Force Retry unpark is not overwritten.
 */
export async function reparkHistoricalBookingJob(
  supabase: SupabaseClient,
  input: {
    jobId: string;
    organizationId?: string;
    job?: {
      attempt_count?: number | null;
      attemptCount?: number | null;
      last_error_code?: string | null;
    } | null;
  }
) {
  const status = parkedHistoricalJobReleaseStatus(input.job);
  let query = supabase
    .from("background_jobs")
    .update({
      status,
      locked_at: null,
      next_attempt_at: HISTORICAL_JOB_HOLD_AT,
    })
    .eq("id", input.jobId)
    .eq("status", "RUNNING");
  if (input.organizationId) query = query.eq("organization_id", input.organizationId);
  return query.select("id, status, next_attempt_at").maybeSingle();
}

export function readSmartAutoRetrySnapshot(metadata: unknown): Partial<SmartAutoRetrySnapshot> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[SMART_AUTO_RETRY_METADATA_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Partial<SmartAutoRetrySnapshot>;
}

export function metadataWithSmartAutoRetry(metadata: unknown, snapshot: SmartAutoRetrySnapshot) {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  return { ...base, [SMART_AUTO_RETRY_METADATA_KEY]: snapshot };
}

export type SmartAutoRetryValidationIssue = {
  field: string;
  message: string;
  code: string;
  correctionKind: Exclude<SmartAutoRetryCorrectionKind, null>;
};

export type SmartAutoRetryValidationInput = {
  shipment: BookingRetryShipment & {
    weight_grams?: number | null;
    weightGrams?: number | null;
    length_cm?: number | null;
    lengthCm?: number | null;
    width_cm?: number | null;
    widthCm?: number | null;
    height_cm?: number | null;
    heightCm?: number | null;
    service_code?: string | null;
    serviceCode?: string | null;
  };
  address?: StoredShippingFields | null;
  customer?: { name?: string | null; phone?: string | null } | null;
  order?: BookingRetryOrder;
  hasActiveContract?: boolean;
};

export function validateShipmentForSmartAutoRetry(input: SmartAutoRetryValidationInput): SmartAutoRetryValidationIssue[] {
  const issues: SmartAutoRetryValidationIssue[] = [];
  const address = input.address ?? null;
  const customerName = String(input.customer?.name ?? address?.name ?? "").trim();
  const customerPhone = indiaPostMobile(input.customer?.phone) ?? indiaPostMobile(address?.phone);
  const country = String(address?.country ?? "IN").trim().toUpperCase();

  if (customerName.length < 3) {
    issues.push({
      field: "customer_name",
      message: "Customer name is required.",
      code: "MISSING_MANDATORY_FIELD",
      correctionKind: "contact",
    });
  }
  if (!customerPhone) {
    issues.push({
      field: "mobile",
      message: "Customer mobile must be a 10-digit Indian number starting with 6, 7, 8 or 9.",
      code: "MISSING_MANDATORY_FIELD",
      correctionKind: "contact",
    });
  }
  if (country && !INDIA_COUNTRY.has(country.replace(/\./g, ""))) {
    issues.push({
      field: "country",
      message: "India Post booking requires an Indian destination country.",
      code: "INVALID_ADDRESS",
      correctionKind: "address",
    });
  }

  const addressBlock = shippingAddressBookingBlock(address);
  if (addressBlock) {
    const pin = String(address?.pincode ?? "").trim();
    const code = pin && !PIN.test(pin) ? "INVALID_PINCODE" : "INVALID_ADDRESS";
    issues.push({
      field: code === "INVALID_PINCODE" ? "pincode" : "address",
      message: addressBlock,
      code,
      correctionKind: "address",
    });
  }

  const serviceCode = String(input.shipment.serviceCode ?? input.shipment.service_code ?? "").trim();
  const weight = toIndiaPostPhysicalWeightGrams(
    input.shipment.weightGrams ?? input.shipment.weight_grams
  );
  if (weight == null || weight < INDIA_POST_WEIGHT_MIN_G || weight > INDIA_POST_WEIGHT_MAX_G) {
    issues.push({
      field: "weight",
      message: "Parcel weight must be a whole number between 1 and 35000 grams.",
      code: "INVALID_WEIGHT",
      correctionKind: "weight",
    });
  }

  const length = Number(input.shipment.lengthCm ?? input.shipment.length_cm) || 0;
  const width = Number(input.shipment.widthCm ?? input.shipment.width_cm) || 0;
  const height = Number(input.shipment.heightCm ?? input.shipment.height_cm) || 0;
  const parcel = isParcelArticle(serviceCode || "SP", weight ?? 0);
  const limits = indiaPostDimensionLimits(serviceCode || "SP", weight ?? 0);
  if (parcel && (length <= 0 || width <= 0 || height <= 0)) {
    issues.push({
      field: "dimensions",
      message: "Parcel length, width and height are required.",
      code: "INVALID_DIMENSIONS",
      correctionKind: "dimensions",
    });
  } else if (length > 0 || width > 0 || height > 0) {
    if (length < limits.length[0] || length > limits.length[1]) {
      issues.push({
        field: "length",
        message: `Length must be between ${limits.length[0]} and ${limits.length[1]} cm.`,
        code: "INVALID_DIMENSIONS",
        correctionKind: "dimensions",
      });
    }
    if (width < limits.width[0] || width > limits.width[1]) {
      issues.push({
        field: "width",
        message: `Width must be between ${limits.width[0]} and ${limits.width[1]} cm.`,
        code: "INVALID_DIMENSIONS",
        correctionKind: "dimensions",
      });
    }
    if (height < limits.height[0] || height > limits.height[1]) {
      issues.push({
        field: "height",
        message: `Height must be between ${limits.height[0]} and ${limits.height[1]} cm.`,
        code: "INVALID_DIMENSIONS",
        correctionKind: "dimensions",
      });
    }
  }
  if (weight != null && weight > limits.weightMax) {
    issues.push({
      field: "weight",
      message: `Weight must be at most ${limits.weightMax} grams for this service.`,
      code: "INVALID_WEIGHT",
      correctionKind: "weight",
    });
  }

  const line1 = String(address?.line1 ?? "").trim();
  if (line1 && (line1.length < 3 || line1.length > INDIA_POST_ADDRESS_LINE_MAX)) {
    issues.push({
      field: "address_line_1",
      message: `Address line 1 must be between 3 and ${INDIA_POST_ADDRESS_LINE_MAX} characters.`,
      code: "INVALID_ADDRESS",
      correctionKind: "address",
    });
  }

  if (input.hasActiveContract === false) {
    issues.push({
      field: "contract",
      message: "No active India Post contract is configured for this booking.",
      code: "INVALID_CONTRACT",
      correctionKind: "contact",
    });
  }

  const orderCheck = evaluateOrderBookingEligibility(input.order);
  if (!orderCheck.eligible) {
    issues.push({
      field: "order",
      message: "The linked order is not eligible for a new India Post booking.",
      code: "BOOKING_REVIEW_REQUIRED",
      correctionKind: "contact",
    });
  }

  return uniqueIssues(issues);
}

function uniqueIssues(issues: SmartAutoRetryValidationIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.field}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function correctionKindFromIssues(issues: SmartAutoRetryValidationIssue[]): SmartAutoRetryCorrectionKind {
  if (issues.some((issue) => issue.correctionKind === "address" || ADDRESS_CODES.has(issue.code))) return "address";
  if (issues.some((issue) => issue.correctionKind === "weight" || issue.code === "INVALID_WEIGHT")) return "weight";
  if (issues.some((issue) => issue.correctionKind === "dimensions")) return "dimensions";
  if (issues.some((issue) => issue.correctionKind === "contact")) return "contact";
  return null;
}

export function merchantStateForCorrection(kind: SmartAutoRetryCorrectionKind): SmartAutoRetryMerchantState {
  if (kind === "address") return "WAITING_FOR_ADDRESS_CORRECTION";
  if (kind === "weight" || kind === "dimensions") return "WAITING_FOR_WEIGHT_CORRECTION";
  if (kind) return "WAITING_FOR_CORRECTION";
  return "WAITING_FOR_CORRECTION";
}

export function classifySmartAutoRetryFailure(input: {
  classified: Pick<ClassifiedError, "code" | "retryable" | "httpStatus">;
  error?: unknown;
  shipment?: BookingRetryShipment | null;
  job?: BookingRetryJob;
}): SmartAutoRetryClass {
  const shipment = input.shipment ?? null;
  const classified = input.classified;
  const bookingPhase = String((input.error as { bookingPhase?: string } | undefined)?.bookingPhase ?? "").toUpperCase();
  const code = String(classified.code ?? "").toUpperCase();

  if (shipment && shipmentOutcomeIsUncertain(shipment, input.job)) return "CEPT_OUTCOME_UNKNOWN";
  if (shipment && readCeptSubmitIntentAt(shipment.metadata)) return "CEPT_OUTCOME_UNKNOWN";
  if (isAmbiguousCeptOutcome(classified) || bookingPhase === "POST_SUBMIT" || code === "CEPT_UNKNOWN") {
    return "CEPT_OUTCOME_UNKNOWN";
  }
  if (code === "ETIMEDOUT" && bookingPhase !== "PRE_POST") return "CEPT_OUTCOME_UNKNOWN";
  if (code === "TEMPORARY_PROVIDER_FAILURE") return "CEPT_OUTCOME_UNKNOWN";

  if (VALIDATION_CODES.has(code)) return "VALIDATION_FAILURE";
  if (PERMANENT_CODES.has(code)) return "PERMANENT_FAILURE";

  if (bookingPhase === "PRE_POST" || code === "PRE_POST_TRANSIENT" || code === "QUEUE_UNAVAILABLE") {
    return "SAFE_TRANSIENT_FAILURE";
  }

  if (NEVER_SUBMITTED_CODES.has(code) && classified.retryable) return "SAFE_TRANSIENT_FAILURE";

  const httpStatus = classified.httpStatus ?? 0;
  if ((httpStatus >= 500 || httpStatus === 429) && bookingPhase !== "PRE_POST") {
    return "CEPT_OUTCOME_UNKNOWN";
  }

  if (classified.retryable && bookingPhase === "PRE_POST") return "SAFE_TRANSIENT_FAILURE";
  if (classified.retryable && NEVER_SUBMITTED_CODES.has(code)) return "SAFE_TRANSIENT_FAILURE";

  return "PERMANENT_FAILURE";
}

export function decideSmartAutoRetry(input: {
  classified: ClassifiedError;
  error?: unknown;
  shipment?: BookingRetryShipment | null;
  job?: BookingRetryJob;
  attempt: number;
  org?: SmartAutoRetryOrgOverrides | null;
  now?: number;
  random?: () => number;
}): {
  enabled: boolean;
  retryClass: SmartAutoRetryClass;
  shouldRetry: boolean;
  retryDelayMs: number;
  merchantState: SmartAutoRetryMerchantState;
  reason: string;
  parkedHistoricalJob: boolean;
} {
  const policy = resolveSmartAutoRetryPolicy(input.org);
  const retryClass = classifySmartAutoRetryFailure(input);
  const parkedHistoricalJob = isParkedHistoricalBookingJob(input.job);
  const maxAttempts = input.job?.maxAttempts ?? input.job?.max_attempts ?? policy.maxAttempts;
  const attempt = input.attempt;
  const eligibility = input.shipment
    ? evaluateBookingRetryEligibility(
        { shipment: input.shipment, job: input.job, purpose: "auto-retry" },
        input.now ?? Date.now()
      )
    : null;
  const historical = input.shipment ? isHistoricalUnauthoredFirstBooking(input.shipment, "auto-retry") : false;

  if (!policy.enabled) {
    return {
      enabled: false,
      retryClass,
      shouldRetry: false,
      retryDelayMs: 0,
      merchantState: merchantStateFromClass(retryClass, false),
      reason: "Smart Auto Retry is disabled.",
      parkedHistoricalJob,
    };
  }

  if (parkedHistoricalJob || historical) {
    return {
      enabled: true,
      retryClass: historical ? "PERMANENT_FAILURE" : retryClass,
      shouldRetry: false,
      retryDelayMs: 0,
      merchantState: "MANUAL_REVIEW",
      reason: "Historical booking jobs stay parked until an explicit merchant Force Retry.",
      parkedHistoricalJob,
    };
  }

  if (retryClass === "CEPT_OUTCOME_UNKNOWN") {
    return {
      enabled: true,
      retryClass,
      shouldRetry: false,
      retryDelayMs: 0,
      merchantState: "RECOVERY_REQUIRED",
      reason: "Booking outcome could not be confirmed. The article was not submitted again.",
      parkedHistoricalJob,
    };
  }

  if (retryClass === "VALIDATION_FAILURE") {
    const kind = correctionKindFromCode(input.classified.code);
    return {
      enabled: true,
      retryClass,
      shouldRetry: false,
      retryDelayMs: 0,
      merchantState: merchantStateForCorrection(kind),
      reason: input.classified.message,
      parkedHistoricalJob,
    };
  }

  if (retryClass === "PERMANENT_FAILURE" || attempt >= maxAttempts) {
    return {
      enabled: true,
      retryClass: attempt >= maxAttempts ? "PERMANENT_FAILURE" : retryClass,
      shouldRetry: false,
      retryDelayMs: 0,
      merchantState: "BOOKING_FAILED",
      reason:
        attempt >= maxAttempts
          ? "Automatic booking retry attempts are exhausted. Review this shipment manually."
          : input.classified.message,
      parkedHistoricalJob,
    };
  }

  if (
    retryClass === "SAFE_TRANSIENT_FAILURE" &&
    eligibility &&
    (eligibility.action === "SAFE_TO_REQUEUE" || eligibility.action === "RETRY_ALREADY_SCHEDULED")
  ) {
    return {
      enabled: true,
      retryClass,
      shouldRetry: true,
      retryDelayMs: smartAutoRetryDelayForAttempt(attempt, policy.delayMs, input.random ?? Math.random),
      merchantState: "AUTO_RETRY_SCHEDULED",
      reason: input.classified.message,
      parkedHistoricalJob,
    };
  }

  return {
    enabled: true,
    retryClass,
    shouldRetry: false,
    retryDelayMs: 0,
    merchantState: "MANUAL_REVIEW",
    reason: eligibility?.reason || input.classified.message,
    parkedHistoricalJob,
  };
}

function merchantStateFromClass(retryClass: SmartAutoRetryClass, scheduled: boolean): SmartAutoRetryMerchantState {
  if (retryClass === "CEPT_OUTCOME_UNKNOWN") return "RECOVERY_REQUIRED";
  if (retryClass === "VALIDATION_FAILURE") return "WAITING_FOR_CORRECTION";
  if (retryClass === "SAFE_TRANSIENT_FAILURE") return scheduled ? "AUTO_RETRY_SCHEDULED" : "RETRYING_BOOKING";
  return "BOOKING_FAILED";
}

function correctionKindFromCode(code: string): SmartAutoRetryCorrectionKind {
  const upper = code.toUpperCase();
  if (ADDRESS_CODES.has(upper)) return "address";
  if (upper === "INVALID_WEIGHT") return "weight";
  if (upper === "INVALID_DIMENSIONS") return "dimensions";
  if (upper === "MISSING_MANDATORY_FIELD" || upper === "VALIDATION_ERROR") return "contact";
  return null;
}

export function merchantSmartAutoRetryView(input: {
  shipment: BookingRetryShipment & { last_error?: string | null; lastError?: string | null };
  job?: BookingRetryJob;
  now?: number;
}): SmartAutoRetrySnapshot {
  const now = input.now ?? Date.now();
  const stored = readSmartAutoRetrySnapshot(input.shipment.metadata);
  const booked = Boolean(input.shipment.bookedAt ?? input.shipment.booked_at);
  const status = String(input.shipment.status ?? "").toUpperCase();
  const jobStatus = String(input.job?.status ?? "").toUpperCase();
  const attemptCount = input.job?.attemptCount ?? input.job?.attempt_count ?? stored?.attemptCount ?? 0;
  const maxAttempts = input.job?.maxAttempts ?? input.job?.max_attempts ?? stored?.maxAttempts ?? smartAutoRetryMaxAttempts();
  const nextAttemptAt = input.job?.nextAttemptAt ?? input.job?.next_attempt_at ?? stored?.nextAttemptAt ?? null;
  const reason =
    stored?.reason ||
    String(input.shipment.lastError ?? input.shipment.last_error ?? "").trim() ||
    "No booking error recorded.";
  const errorCode = stored?.errorCode ?? input.shipment.lastErrorCode ?? input.shipment.last_error_code ?? null;
  const parked = isParkedHistoricalBookingJob(input.job);

  if (booked || status === "BOOKED") {
    return {
      class: null,
      merchantState: "BOOKED_SUCCESSFULLY",
      attemptCount,
      maxAttempts,
      nextAttemptAt: null,
      reason: "Booked with India Post.",
      errorCode: null,
      correctionKind: null,
      canEditShipment: false,
      updatedAt: stored?.updatedAt ?? new Date(now).toISOString(),
    };
  }

  if (parked || isHistoricalUnauthoredFirstBooking(input.shipment, "auto-retry")) {
    return {
      class: "PERMANENT_FAILURE",
      merchantState: "MANUAL_REVIEW",
      attemptCount,
      maxAttempts,
      nextAttemptAt: parked ? nextAttemptAt : null,
      reason: "This historical booking is held for manual review.",
      errorCode,
      correctionKind: null,
      canEditShipment: false,
      updatedAt: stored?.updatedAt ?? new Date(now).toISOString(),
    };
  }

  if (status === "RECOVERY_REQUIRED" || shipmentOutcomeIsUncertain(input.shipment, input.job)) {
    return {
      class: "CEPT_OUTCOME_UNKNOWN",
      merchantState: "RECOVERY_REQUIRED",
      attemptCount,
      maxAttempts,
      nextAttemptAt: null,
      reason: "Booking outcome could not be confirmed. This is not a normal retryable failure.",
      errorCode,
      correctionKind: null,
      canEditShipment: false,
      updatedAt: stored?.updatedAt ?? new Date(now).toISOString(),
    };
  }

  const code = String(errorCode ?? "").toUpperCase();
  if (VALIDATION_CODES.has(code) || stored?.class === "VALIDATION_FAILURE") {
    const kind = stored?.correctionKind ?? correctionKindFromCode(code);
    return {
      class: "VALIDATION_FAILURE",
      merchantState: merchantStateForCorrection(kind),
      attemptCount,
      maxAttempts,
      nextAttemptAt: null,
      reason,
      errorCode,
      correctionKind: kind,
      canEditShipment: true,
      updatedAt: stored?.updatedAt ?? new Date(now).toISOString(),
    };
  }

  if (jobStatus === "RUNNING" || status === "BOOKING") {
    return {
      class: stored?.class ?? "SAFE_TRANSIENT_FAILURE",
      merchantState: "RETRYING_BOOKING",
      attemptCount,
      maxAttempts,
      nextAttemptAt,
      reason,
      errorCode,
      correctionKind: null,
      canEditShipment: false,
      updatedAt: stored?.updatedAt ?? new Date(now).toISOString(),
    };
  }

  if (jobStatus === "RETRYING" || stored?.merchantState === "AUTO_RETRY_SCHEDULED") {
    return {
      class: "SAFE_TRANSIENT_FAILURE",
      merchantState: "AUTO_RETRY_SCHEDULED",
      attemptCount,
      maxAttempts,
      nextAttemptAt,
      reason,
      errorCode,
      correctionKind: null,
      canEditShipment: false,
      updatedAt: stored?.updatedAt ?? new Date(now).toISOString(),
    };
  }

  if (status === "FAILED" || stored?.merchantState === "BOOKING_FAILED") {
    return {
      class: stored?.class ?? "PERMANENT_FAILURE",
      merchantState: "BOOKING_FAILED",
      attemptCount,
      maxAttempts,
      nextAttemptAt: null,
      reason,
      errorCode,
      correctionKind: stored?.correctionKind ?? null,
      canEditShipment: Boolean(stored?.canEditShipment),
      updatedAt: stored?.updatedAt ?? new Date(now).toISOString(),
    };
  }

  return {
    class: stored?.class ?? null,
    merchantState: stored?.merchantState ?? "RETRYING_BOOKING",
    attemptCount,
    maxAttempts,
    nextAttemptAt,
    reason,
    errorCode,
    correctionKind: stored?.correctionKind ?? null,
    canEditShipment: Boolean(stored?.canEditShipment),
    updatedAt: stored?.updatedAt ?? new Date(now).toISOString(),
  };
}

function snapshotNow(partial: Omit<SmartAutoRetrySnapshot, "updatedAt">): SmartAutoRetrySnapshot {
  return { ...partial, updatedAt: new Date().toISOString() };
}

export async function persistSmartAutoRetrySnapshot(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    shipmentId: string;
    metadata: unknown;
    snapshot: SmartAutoRetrySnapshot;
  }
) {
  const nextMetadata = metadataWithSmartAutoRetry(input.metadata, input.snapshot);
  await supabase
    .from("shipments")
    .update({ metadata: nextMetadata })
    .eq("id", input.shipmentId)
    .eq("organization_id", input.organizationId)
    .is("booked_at", null);
}

export async function scheduleSmartAutoRetry(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    shipmentId: string;
    userId?: string | null;
    delayMs: number;
    snapshot: SmartAutoRetrySnapshot;
    metadata?: unknown;
  }
): Promise<{ jobId: string | null; scheduled: boolean; skippedReason?: string }> {
  if (!smartAutoBookingRetryEnabled()) {
    return { jobId: null, scheduled: false, skippedReason: "disabled" };
  }
  const latest = await loadLatestShipmentBookingJob(supabase, {
    organizationId: input.organizationId,
    entityId: input.shipmentId,
  });
  if (isParkedHistoricalBookingJob(latest)) {
    logInfo("smart_auto_retry.historical_hold", {
      organizationId: input.organizationId,
      shipmentId: input.shipmentId,
      jobId: latest?.id,
    });
    return { jobId: latest?.id ?? null, scheduled: false, skippedReason: "historical_hold" };
  }

  const job = latest?.id
    ? latest
    : await enqueueShipmentBookingJob(supabase, {
        organizationId: input.organizationId,
        jobType: "shipment-booking",
        entityType: "shipment",
        entityId: input.shipmentId,
        userId: input.userId ?? undefined,
      });

  if (isParkedHistoricalBookingJob(job)) {
    return { jobId: job.id, scheduled: false, skippedReason: "historical_hold" };
  }

  const nextAttemptAt = new Date(Date.now() + Math.max(0, input.delayMs)).toISOString();
  const state = String(job.status ?? "").toUpperCase();
  if (state === "RUNNING") {
    return { jobId: job.id, scheduled: false, skippedReason: "in_progress" };
  }
  if (state === "SUCCEEDED") {
    return { jobId: job.id, scheduled: false, skippedReason: "succeeded" };
  }

  if (state === "RETRYING" || state === "FAILED") {
    const { data, error } = await supabase
      .from("background_jobs")
      .update({
        status: "RETRYING",
        last_error: input.snapshot.reason,
        last_error_code: input.snapshot.errorCode,
        next_attempt_at: nextAttemptAt,
      })
      .eq("id", job.id)
      .eq("organization_id", input.organizationId)
      .in("status", ["RETRYING", "FAILED"])
      .select("id, next_attempt_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { jobId: job.id, scheduled: false, skippedReason: "job_claim_lost" };
    if (isParkedHistoricalBookingJob(data)) {
      return { jobId: job.id, scheduled: false, skippedReason: "historical_hold" };
    }
  }

  await persistSmartAutoRetrySnapshot(supabase, {
    organizationId: input.organizationId,
    shipmentId: input.shipmentId,
    metadata: input.metadata,
    snapshot: { ...input.snapshot, nextAttemptAt, merchantState: "AUTO_RETRY_SCHEDULED" },
  });
  logInfo("smart_auto_retry.scheduled", {
    organizationId: input.organizationId,
    shipmentId: input.shipmentId,
    jobId: job.id,
    nextAttemptAt,
  });
  return { jobId: job.id, scheduled: true };
}

export async function resumeSmartAutoRetryAfterCorrection(
  supabase: SupabaseClient,
  input: { organizationId: string; shipmentIds: string[]; userId?: string | null }
) {
  if (!smartAutoBookingRetryEnabled() || !input.shipmentIds.length) {
    return { resumed: 0, skipped: input.shipmentIds.length };
  }
  let resumed = 0;
  let skipped = 0;
  for (const shipmentId of [...new Set(input.shipmentIds)]) {
    const result = await resumeOneShipment(supabase, input.organizationId, shipmentId, input.userId);
    if (result) resumed += 1;
    else skipped += 1;
  }
  return { resumed, skipped };
}

async function resumeOneShipment(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentId: string,
  userId?: string | null
) {
  const { data: shipment } = await supabase
    .from("shipments")
    .select(
      "id, status, booked_at, barcode, tracking_number, provider_ref, last_error, last_error_code, metadata, created_at, updated_at, weight_grams, length_cm, width_cm, height_cm, service_code, organization_id, order_id, orders(status, fulfillment_status), customers(name, phone), addresses:shipping_address_id(*)"
    )
    .eq("id", shipmentId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!shipment) return false;
  const order = Array.isArray(shipment.orders) ? shipment.orders[0] : shipment.orders;
  const customer = Array.isArray(shipment.customers) ? shipment.customers[0] : shipment.customers;
  const address = Array.isArray(shipment.addresses) ? shipment.addresses[0] : shipment.addresses;
  const job = await loadLatestShipmentBookingJob(supabase, { organizationId, entityId: shipmentId });
  if (isParkedHistoricalBookingJob(job) || isHistoricalUnauthoredFirstBooking(shipment, "auto-retry")) {
    return false;
  }
  const eligibility = evaluateBookingRetryEligibility({
    shipment,
    job,
    order: order ?? null,
    purpose: "auto-retry",
  });
  if (!eligibility.eligible && eligibility.action !== "RETRY_ALREADY_SCHEDULED" && eligibility.action !== "MAX_ATTEMPTS_EXCEEDED") {
    return false;
  }
  if (eligibility.action === "BOOKING_OUTCOME_UNKNOWN" || eligibility.action === "ALREADY_BOOKED") {
    return false;
  }
  const issues = validateShipmentForSmartAutoRetry({
    shipment,
    address: (address ?? null) as StoredShippingFields | null,
    customer: customer ?? null,
    order: order ?? null,
  });
  if (issues.length) {
    const kind = correctionKindFromIssues(issues);
    const snapshot = snapshotNow({
      class: "VALIDATION_FAILURE",
      merchantState: merchantStateForCorrection(kind),
      attemptCount: job?.attempt_count ?? 0,
      maxAttempts: job?.max_attempts ?? smartAutoRetryMaxAttempts(),
      nextAttemptAt: null,
      reason: issues[0].message,
      errorCode: issues[0].code,
      correctionKind: kind,
      canEditShipment: true,
    });
    await supabase
      .from("shipments")
      .update({
        status: "FAILED",
        last_error: issues[0].message,
        last_error_code: issues[0].code,
        metadata: metadataWithSmartAutoRetry(shipment.metadata, snapshot),
      })
      .eq("id", shipmentId)
      .eq("organization_id", organizationId)
      .is("booked_at", null)
      .is("barcode", null)
      .is("tracking_number", null)
      .is("provider_ref", null)
      .filter("metadata->>ceptSubmitIntentAt", "is", null);
    return false;
  }
  if (eligibility.action === "MAX_ATTEMPTS_EXCEEDED") return false;
  const snapshot = snapshotNow({
    class: "SAFE_TRANSIENT_FAILURE",
    merchantState: "AUTO_RETRY_SCHEDULED",
    attemptCount: job?.attempt_count ?? 0,
    maxAttempts: job?.max_attempts ?? smartAutoRetryMaxAttempts(),
    nextAttemptAt: null,
    reason: "Shipping information was corrected. Automatic booking will resume.",
    errorCode: "PRE_POST_TRANSIENT",
    correctionKind: null,
    canEditShipment: false,
  });
  const scheduled = await scheduleSmartAutoRetry(supabase, {
    organizationId,
    shipmentId,
    userId,
    delayMs: 0,
    snapshot,
    metadata: shipment.metadata,
  });
  if (scheduled.scheduled) {
    await supabase
      .from("shipments")
      .update({
        status: "QUEUED",
        last_error: snapshot.reason,
        last_error_code: "PRE_POST_TRANSIENT",
      })
      .eq("id", shipmentId)
      .eq("organization_id", organizationId)
      .is("booked_at", null)
      .in("status", ["DRAFT", "VALIDATING", "QUEUED", "FAILED"])
      .is("barcode", null)
      .is("tracking_number", null)
      .is("provider_ref", null)
      .filter("metadata->>ceptSubmitIntentAt", "is", null);
  }
  return scheduled.scheduled;
}

export function classifyProviderErrorForSmartAutoRetry(error: unknown) {
  return classifyProviderError(error);
}
