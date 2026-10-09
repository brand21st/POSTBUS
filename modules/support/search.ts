export const SUPPORT_SEARCH_DEBOUNCE_MS = 300;
export const SUPPORT_SEARCH_MAX = 64;

export function sanitizeSupportSearch(raw?: string | null) {
  const trimmed = (raw ?? "").trim().slice(0, SUPPORT_SEARCH_MAX);
  if (!trimmed) return "";
  return trimmed.replace(/[^a-zA-Z0-9+#.\s-]/g, "").replace(/\s+/g, " ").trim();
}

export function supportConversationsQueryString(input: {
  filter?: string;
  category?: string;
  q?: string;
}) {
  const params = new URLSearchParams();
  params.set("filter", input.filter || "all");
  if (input.category) params.set("category", input.category);
  const q = sanitizeSupportSearch(input.q);
  if (q) params.set("q", q);
  return `/api/v1/support/conversations?${params.toString()}`;
}
