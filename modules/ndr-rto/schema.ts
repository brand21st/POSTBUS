import { z } from "zod";
import { NDR_BUCKETS } from "@/types/domain";

function blankToUndefined(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export const ndrListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.preprocess(blankToUndefined, z.string().max(120).optional()),
  bucket: z.preprocess(blankToUndefined, z.enum(NDR_BUCKETS).optional()),
  from: z.preprocess(blankToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  to: z.preprocess(blankToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  status: z.preprocess(blankToUndefined, z.string().max(40).optional()),
  event: z.preprocess(blankToUndefined, z.string().max(120).optional()),
  customer: z.preprocess(blankToUndefined, z.string().max(120).optional()),
  orderId: z.preprocess(blankToUndefined, z.string().max(80).optional()),
  trackingId: z.preprocess(blankToUndefined, z.string().max(40).optional()),
  pincode: z.preprocess(blankToUndefined, z.string().max(12).optional()),
});

export type NdrListQuery = z.infer<typeof ndrListQuery>;
