import {
  PARCEL_HEIGHT_MAX_CM,
  PARCEL_HEIGHT_MIN_CM,
  PARCEL_LENGTH_MAX_CM,
  PARCEL_LENGTH_MIN_CM,
  PARCEL_WIDTH_MAX_CM,
  PARCEL_WIDTH_MIN_CM,
} from "@/modules/india-post/parcel-defaults";
import { INDIA_POST_WEIGHT_MAX_G, INDIA_POST_WEIGHT_MIN_G } from "@/modules/india-post/weight";

export type BulkCandidate = {
  shipmentId: string;
  jobId: string;
  organizationId: string;
  indiaPostConnectionId?: string;
  indiaPostCustomerId: string;
  contractId: string;
  serviceCode: string;
  articleType?: string;
  officeId?: string;
  environment: "UAT" | "PRODUCTION";
  createdAt: string;
  barcode?: string | null;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightGrams: number;
  status: string;
  bookingState?: string | null;
};

export type BulkCompatibilityKey = {
  organizationId: string;
  indiaPostConnectionId?: string;
  indiaPostCustomerId: string;
  contractId: string;
  serviceCode: string;
  articleType?: string;
  officeId?: string;
  environment: "UAT" | "PRODUCTION";
};

export function bulkCompatibilityKey(row: BulkCompatibilityKey) {
  return [
    row.organizationId,
    row.indiaPostConnectionId ?? "",
    row.indiaPostCustomerId,
    row.contractId,
    row.serviceCode,
    row.articleType ?? row.serviceCode,
    row.officeId ?? "",
    row.environment,
  ].join("|");
}

export function bulkDimensionEligible(row: Pick<BulkCandidate, "lengthCm" | "widthCm" | "heightCm" | "weightGrams">) {
  return (
    row.lengthCm >= PARCEL_LENGTH_MIN_CM &&
    row.lengthCm <= PARCEL_LENGTH_MAX_CM &&
    row.widthCm >= PARCEL_WIDTH_MIN_CM &&
    row.widthCm <= PARCEL_WIDTH_MAX_CM &&
    row.heightCm >= PARCEL_HEIGHT_MIN_CM &&
    row.heightCm <= PARCEL_HEIGHT_MAX_CM &&
    row.weightGrams >= INDIA_POST_WEIGHT_MIN_G &&
    row.weightGrams <= INDIA_POST_WEIGHT_MAX_G
  );
}

export function bulkShipmentEligible(row: BulkCandidate) {
  if (row.status !== "QUEUED") return false;
  if (row.bookingState && row.bookingState !== "QUEUED" && row.bookingState !== "READY") return false;
  return bulkDimensionEligible(row);
}

export function rejectIncompatibleBulkMix(rows: BulkCandidate[]) {
  if (!rows.length) return { ok: true as const };
  const key = bulkCompatibilityKey(rows[0]);
  const mismatch = rows.find((row) => bulkCompatibilityKey(row) !== key);
  if (!mismatch) return { ok: true as const };
  return {
    ok: false as const,
    reason: "INCOMPATIBLE_BATCH_MIX",
    expected: key,
    found: bulkCompatibilityKey(mismatch),
  };
}
