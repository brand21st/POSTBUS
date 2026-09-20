const UNSAFE_POSTGREST = /[,().\\%*_]/g;

export function sanitizePostgrestValue(value: string) {
  return value.replace(UNSAFE_POSTGREST, "").trim();
}

export function ilikePattern(value: string) {
  const safe = sanitizePostgrestValue(value);
  return safe ? `%${safe}%` : null;
}

export function orIlike(columns: string[], value: string) {
  const pattern = ilikePattern(value);
  if (!pattern) return null;
  return columns.map((column) => `${column}.ilike.${pattern}`).join(",");
}

export function orExact(columns: string[], value: string) {
  const safe = sanitizePostgrestValue(value);
  if (!safe) return null;
  return columns.map((column) => `${column}.eq.${safe}`).join(",");
}
