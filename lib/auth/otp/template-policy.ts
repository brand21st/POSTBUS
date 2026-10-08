export type OtpTemplateRecord = {
  name: string;
  status: string | null;
  category: string | null;
};

export type OtpTemplateDecision =
  | { allow: true }
  | {
      allow: false;
      reason:
        | "missing_name"
        | "catalog_unavailable"
        | "not_found"
        | "category_unverified"
        | "not_authentication"
        | "not_approved";
    };

function normalized(value: string | null | undefined) {
  return value?.trim().toUpperCase() || "";
}

/**
 * OTP may be sent only when the named template is present, APPROVED,
 * and category AUTHENTICATION. A missing category is not treated as approved.
 */
export function otpTemplateDecision(templateName: string, catalog: OtpTemplateRecord[] | null): OtpTemplateDecision {
  const wanted = templateName.trim();
  if (!wanted) return { allow: false, reason: "missing_name" };
  if (!catalog) return { allow: false, reason: "catalog_unavailable" };
  const matches = catalog.filter((row) => row.name.trim() === wanted);
  if (!matches.length) return { allow: false, reason: "not_found" };
  if (matches.some((row) => normalized(row.category) === "AUTHENTICATION" && normalized(row.status) === "APPROVED")) {
    return { allow: true };
  }
  if (!matches.some((row) => normalized(row.category))) {
    return { allow: false, reason: "category_unverified" };
  }
  if (!matches.some((row) => normalized(row.category) === "AUTHENTICATION")) {
    return { allow: false, reason: "not_authentication" };
  }
  return { allow: false, reason: "not_approved" };
}
