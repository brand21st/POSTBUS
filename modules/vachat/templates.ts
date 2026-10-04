export type VachatApprovedTemplate = { name: string; language: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function unwrapVachatData(json: unknown): Record<string, unknown> {
  const root = asRecord(json);
  if (!root) return {};
  const nested = asRecord(root.data);
  return nested ?? root;
}

function languageOf(item: Record<string, unknown>) {
  if (typeof item.language === "string" && item.language.trim()) return item.language.trim();
  const nested = asRecord(item.language);
  if (typeof nested?.code === "string" && nested.code.trim()) return nested.code.trim();
  return "en_US";
}

function mapApprovedItem(item: unknown): VachatApprovedTemplate | null {
  const row = asRecord(item);
  if (!row) return null;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) return null;
  const status = String(row.status ?? "APPROVED").toUpperCase();
  if (status && status !== "APPROVED") return null;
  return { name, language: languageOf(row) };
}

export function approvedVachatTemplates(raw: unknown): VachatApprovedTemplate[] {
  const obj = unwrapVachatData(raw);
  const nested = asRecord(obj.templates);
  const lists = [obj.approved_templates, obj.approvedTemplates, nested?.approved_templates, obj.templates];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    const mapped = list.map(mapApprovedItem).filter((row): row is VachatApprovedTemplate => Boolean(row));
    if (mapped.length) return mapped;
  }
  return [];
}

export function withApprovedVachatTemplates(raw: unknown) {
  const obj = unwrapVachatData(raw);
  return {
    ...obj,
    approved_templates: approvedVachatTemplates(obj),
  };
}
