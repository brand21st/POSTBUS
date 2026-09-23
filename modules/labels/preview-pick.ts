export function pickOfficialPreviewLabel<
  T extends {
    kind?: string | null;
    status?: string | null;
    fileUrl?: string | null;
    file_url?: string | null;
  },
>(items: T[]) {
  const official = items.filter(
    (row) => (row.kind ?? "INDIA_POST") === "INDIA_POST" && (row.status ?? "").toUpperCase() === "READY"
  );
  return official.find((row) => Boolean(row.fileUrl || row.file_url)) ?? official[0] ?? null;
}
