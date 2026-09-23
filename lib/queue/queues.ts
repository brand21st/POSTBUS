import { Queue, type JobsOptions } from "bullmq";
import { getRedis } from "@/lib/queue/connection";
import type { JobType } from "@/types/domain";

export const QUEUE_NAMES = {
  shopifySync: "shopify-sync",
  shipmentBooking: "shipment-booking",
  labelGeneration: "label-generation",
  manifestGeneration: "manifest-generation",
  trackingSync: "tracking-sync",
  webhookProcessing: "webhook-processing",
  indiaPostEvents: "india-post-events",
  notifications: "notifications",
  cleanup: "cleanup",
  reports: "reports",
  shopifyFulfillment: "shopify-fulfillment",
  watiNotify: "wati-notify",
  invoiceGeneration: "invoice-generation",
} as const;

const queues = new Map<string, Queue>();

export function getQueue(name: string) {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: getRedis() });
    queues.set(name, queue);
  }
  return queue;
}

export type JobPayload = {
  organizationId: string;
  jobId: string;
  entityType?: string;
  entityId?: string;
  userId?: string;
};

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "custom" },
  removeOnComplete: { age: 60 * 60 * 24 * 7, count: 1000 },
  removeOnFail: { age: 60 * 60 * 24 * 30 },
};

export async function enqueueJob(type: JobType, payload: JobPayload, opts?: JobsOptions) {
  const queue = getQueue(type);
  const add = queue.add(type, payload, {
    ...defaultJobOptions,
    jobId: `${type}:${payload.organizationId}:${payload.entityId ?? payload.jobId}`,
    ...opts,
  });
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Redis enqueue timed out")), 2000);
  });
  return Promise.race([add, timeout]);
}
