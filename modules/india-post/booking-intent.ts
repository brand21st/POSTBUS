/** Durable proof that a CEPT booking POST was about to be sent. Stored on shipments.metadata. */
export const CEPT_SUBMIT_INTENT_AT = "ceptSubmitIntentAt";
/** Merchant confirmed a second CEPT POST after an unknown first outcome. */
export const CEPT_FORCE_RESUBMIT_AT = "ceptForceResubmitAt";

export function readCeptSubmitIntentAt(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[CEPT_SUBMIT_INTENT_AT];
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

/** Preserves an existing intent timestamp. A retry must not clear it. */
export function metadataWithCeptSubmitIntent(metadata: unknown, at: string) {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  const existing = readCeptSubmitIntentAt(base);
  if (existing) return base;
  return { ...base, [CEPT_SUBMIT_INTENT_AT]: at };
}

export function readCeptForceResubmitAt(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[CEPT_FORCE_RESUBMIT_AT];
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

export function metadataWithCeptForceResubmit(metadata: unknown, at: string) {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  return { ...base, [CEPT_FORCE_RESUBMIT_AT]: at };
}
