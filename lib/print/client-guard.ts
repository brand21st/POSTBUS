const inFlight = new Set<string>();

/** Returns an idempotency key, or null if this UI action is already in flight. */
export function beginClientPrint(scope: string, existingKey?: string | null): string | null {
  if (inFlight.has(scope)) return null;
  inFlight.add(scope);
  return existingKey?.trim() || crypto.randomUUID();
}

export function endClientPrint(scope: string) {
  inFlight.delete(scope);
}
