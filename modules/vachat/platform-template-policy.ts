export type PlatformTemplateRecord = {
  name: string;
  status: string | null;
  category: string | null;
  language?: string | null;
};

export type PlatformTemplateDecision =
  | { allow: true; language: string | null }
  | {
      allow: false;
      reason:
        | "missing_name"
        | "catalog_unavailable"
        | "not_found"
        | "not_approved"
        | "authentication_forbidden";
    };

function normalized(value: string | null | undefined) {
  return value?.trim().toUpperCase() || "";
}

/**
 * Platform UTILITY/MARKETING templates only. AUTHENTICATION is reserved for OTP.
 */
export function platformTemplateDecision(
  templateName: string,
  catalog: PlatformTemplateRecord[] | null
): PlatformTemplateDecision {
  const wanted = templateName.trim();
  if (!wanted) return { allow: false, reason: "missing_name" };
  if (!catalog) return { allow: false, reason: "catalog_unavailable" };
  const matches = catalog.filter((row) => row.name.trim() === wanted);
  if (!matches.length) return { allow: false, reason: "not_found" };
  if (matches.some((row) => normalized(row.category) === "AUTHENTICATION")) {
    return { allow: false, reason: "authentication_forbidden" };
  }
  const approved = matches.find((row) => normalized(row.status) === "APPROVED");
  if (!approved) return { allow: false, reason: "not_approved" };
  return { allow: true, language: approved.language?.trim() || null };
}
