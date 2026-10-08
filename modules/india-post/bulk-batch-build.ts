import { createHash } from "node:crypto";
import { indiaPostBulkMaxArticles } from "@/modules/india-post/bulk-config";
import {
  bulkCompatibilityKey,
  bulkShipmentEligible,
  rejectIncompatibleBulkMix,
  type BulkCandidate,
} from "@/modules/india-post/bulk-eligibility";

/**
 * Queue order is preserved. claim_background_jobs still uses created_at only.
 * Batch construction uses created_at then job_id then shipment_id as a stable
 * tie-breaker among shipments already selected for the same compatibility key.
 * That does not change which job the worker claims first.
 */
export function sortBulkCandidatesDeterministically(rows: BulkCandidate[]) {
  return [...rows].sort((a, b) => {
    const created = a.createdAt.localeCompare(b.createdAt);
    if (created !== 0) return created;
    const job = a.jobId.localeCompare(b.jobId);
    if (job !== 0) return job;
    return a.shipmentId.localeCompare(b.shipmentId);
  });
}

export function requestFingerprint(organizationId: string, shipmentIds: string[]) {
  const payload = `${organizationId}:${[...shipmentIds].sort().join(",")}`;
  return createHash("sha256").update(payload).digest("hex");
}

export type BuiltBulkBatch = {
  organizationId: string;
  indiaPostCustomerId: string;
  contractId: string;
  serviceCode: string;
  environment: "UAT" | "PRODUCTION";
  shipmentIds: string[];
  barcodes: Array<string | null>;
  requestFingerprint: string;
};

export type BulkBuildResult = {
  batches: BuiltBulkBatch[];
  leftovers: BulkCandidate[];
};

export function buildIndiaPostBulkBatches(
  rows: BulkCandidate[],
  options?: { maxArticles?: number; activeShipmentIds?: Set<string> }
): BulkBuildResult {
  const maxArticles = options?.maxArticles ?? indiaPostBulkMaxArticles();
  const active = options?.activeShipmentIds ?? new Set<string>();
  const sorted = sortBulkCandidatesDeterministically(rows);
  const groups = new Map<string, BulkCandidate[]>();
  const leftovers: BulkCandidate[] = [];

  for (const row of sorted) {
    if (!bulkShipmentEligible(row) || active.has(row.shipmentId)) {
      leftovers.push(row);
      continue;
    }
    const key = bulkCompatibilityKey(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const batches: BuiltBulkBatch[] = [];
  for (const group of groups.values()) {
    const mix = rejectIncompatibleBulkMix(group);
    if (!mix.ok) {
      leftovers.push(...group);
      continue;
    }
    const unique = dedupeShipments(group);
    for (let i = 0; i < unique.length; i += maxArticles) {
      const slice = unique.slice(i, i + maxArticles);
      if (slice.length < 2) {
        leftovers.push(...slice);
        continue;
      }
      const shipmentIds = slice.map((row) => row.shipmentId);
      batches.push({
        organizationId: slice[0].organizationId,
        indiaPostCustomerId: slice[0].indiaPostCustomerId,
        contractId: slice[0].contractId,
        serviceCode: slice[0].serviceCode,
        environment: slice[0].environment,
        shipmentIds,
        barcodes: slice.map((row) => row.barcode ?? null),
        requestFingerprint: requestFingerprint(slice[0].organizationId, shipmentIds),
      });
    }
  }

  return { batches, leftovers };
}

function dedupeShipments(rows: BulkCandidate[]) {
  const seen = new Set<string>();
  const out: BulkCandidate[] = [];
  for (const row of rows) {
    if (seen.has(row.shipmentId)) continue;
    seen.add(row.shipmentId);
    out.push(row);
  }
  return out;
}

export function barcodesAreUnique(barcodes: Array<string | null | undefined>) {
  const values = barcodes.filter((value): value is string => Boolean(value));
  return new Set(values).size === values.length;
}
