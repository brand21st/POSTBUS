import { z } from "zod";

export const MANIFEST_STATUSES = ["DRAFT", "CLOSED", "HANDED_OVER"] as const;
export type ManifestStatus = (typeof MANIFEST_STATUSES)[number];

/** Shipments that can sit on a manifest (booked with a barcode, not yet moving in India Post). */
export const MANIFEST_ELIGIBLE_STATUSES = [
  "BOOKED",
  "LABEL_PENDING",
  "LABEL_READY",
  "MANIFEST_PENDING",
  "MANIFEST_READY",
] as const;

/** Statuses a sweep picks up automatically; BOOKED/LABEL_PENDING wait for their label. */
export const MANIFEST_SWEEP_STATUSES = ["LABEL_READY", "MANIFEST_PENDING", "MANIFEST_READY"] as const;

/** Sweeps and the "add shipments" picker ignore bookings older than this. */
export const MANIFEST_ELIGIBLE_DAYS = 14;

/** Handed-over shipments still unscanned after this long are flagged. */
export const MANIFEST_UNSCANNED_GRACE_MS = 24 * 60 * 60 * 1000;

export const MANIFEST_MAX_ADD = 500;

export const MANIFEST_PROOF_MAX_BYTES = 10 * 1024 * 1024;
export const MANIFEST_PROOF_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

function blankToUndefined(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export const manifestListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.preprocess(blankToUndefined, z.enum(MANIFEST_STATUSES).optional()),
});
export type ManifestListQuery = z.infer<typeof manifestListQuery>;

export const manifestAddBody = z.object({
  shipmentIds: z.array(z.string().uuid()).min(1).max(MANIFEST_MAX_ADD),
});

export const manifestHandoverBody = z.object({
  handedOverTo: z.preprocess(blankToUndefined, z.string().max(120).optional()),
  notes: z.preprocess(blankToUndefined, z.string().max(1000).optional()),
});
export type ManifestHandoverInput = z.infer<typeof manifestHandoverBody>;

export const manifestExportFormat = z.enum(["xlsx", "csv", "pdf"]).default("xlsx");
export type ManifestExportFormat = z.infer<typeof manifestExportFormat>;
