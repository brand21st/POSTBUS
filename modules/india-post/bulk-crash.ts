import { bulkWorkerMayPost } from "@/modules/india-post/bulk-run";
import type { BulkCrashPoint } from "@/modules/india-post/bulk-recovery";
import type { IndiaPostBulkBatchStatus } from "@/modules/india-post/bulk-state";

export type BulkCrashScenario = {
  id: `CRASH-${string}`;
  point: BulkCrashPoint;
  batchStatus: IndiaPostBulkBatchStatus;
  shipmentStatus: "QUEUED" | "BOOKING" | "BOOKED" | "FAILED" | "RECOVERY_REQUIRED";
  jobStatus: "QUEUED" | "RUNNING" | "RETRYING" | "SUCCEEDED" | "FAILED";
  ceptPostCount: 0 | 1;
  barcodeAllocated: boolean;
  trackingPersisted: boolean;
};

export const INDIA_POST_BULK_CRASH_SCENARIOS: BulkCrashScenario[] = [
  {
    id: "CRASH-01",
    point: "after_batch_creation",
    batchStatus: "READY",
    shipmentStatus: "QUEUED",
    jobStatus: "QUEUED",
    ceptPostCount: 0,
    barcodeAllocated: true,
    trackingPersisted: false,
  },
  {
    id: "CRASH-02",
    point: "after_membership_creation",
    batchStatus: "READY",
    shipmentStatus: "QUEUED",
    jobStatus: "QUEUED",
    ceptPostCount: 0,
    barcodeAllocated: true,
    trackingPersisted: false,
  },
  {
    id: "CRASH-03",
    point: "after_membership_creation",
    batchStatus: "READY",
    shipmentStatus: "QUEUED",
    jobStatus: "QUEUED",
    ceptPostCount: 0,
    barcodeAllocated: true,
    trackingPersisted: false,
  },
  {
    id: "CRASH-04",
    point: "after_lock",
    batchStatus: "SUBMITTING",
    shipmentStatus: "BOOKING",
    jobStatus: "RUNNING",
    ceptPostCount: 0,
    barcodeAllocated: true,
    trackingPersisted: false,
  },
  {
    id: "CRASH-05",
    point: "immediately_before_cept_post",
    batchStatus: "SUBMITTING",
    shipmentStatus: "BOOKING",
    jobStatus: "RUNNING",
    ceptPostCount: 0,
    barcodeAllocated: true,
    trackingPersisted: false,
  },
  {
    id: "CRASH-06",
    point: "immediately_after_cept_post",
    batchStatus: "SUBMITTING",
    shipmentStatus: "BOOKING",
    jobStatus: "RUNNING",
    ceptPostCount: 1,
    barcodeAllocated: true,
    trackingPersisted: false,
  },
  {
    id: "CRASH-07",
    point: "after_cept_before_db_commit",
    batchStatus: "SUBMITTED",
    shipmentStatus: "BOOKING",
    jobStatus: "RUNNING",
    ceptPostCount: 1,
    barcodeAllocated: true,
    trackingPersisted: false,
  },
  {
    id: "CRASH-08",
    point: "after_partial_article_reconciliation",
    batchStatus: "RECONCILING",
    shipmentStatus: "BOOKED",
    jobStatus: "RUNNING",
    ceptPostCount: 1,
    barcodeAllocated: true,
    trackingPersisted: true,
  },
  {
    id: "CRASH-09",
    point: "after_cept_before_db_commit",
    batchStatus: "SUBMITTED",
    shipmentStatus: "BOOKING",
    jobStatus: "RUNNING",
    ceptPostCount: 1,
    barcodeAllocated: true,
    trackingPersisted: false,
  },
  {
    id: "CRASH-10",
    point: "before_label_generation",
    batchStatus: "PARTIAL_SUCCESS",
    shipmentStatus: "BOOKED",
    jobStatus: "SUCCEEDED",
    ceptPostCount: 1,
    barcodeAllocated: true,
    trackingPersisted: true,
  },
];

export function evaluateBulkCrashRestart(scenario: BulkCrashScenario) {
  const mayResubmit = bulkWorkerMayPost(scenario.batchStatus, scenario.point);
  return {
    ...scenario,
    mayResubmit,
    recoveryRequired: scenario.ceptPostCount === 1 && !mayResubmit,
    barcodeMayBeReallocated: false,
  };
}
