/** Classifies subscription tax evidence. Never invents a GST rate. */
export type TaxEvidenceVerdict = "VERIFIED" | "MISSING" | "INVALID" | "CONFLICT" | "MANUAL_REVIEW_REQUIRED";

export function classifyTaxEvidence(input: {
    capturedPaise: bigint;
    refundedPaise?: bigint;
    taxPaise?: bigint | null;
    refundedTaxPaise?: bigint | null;
    hasExisting: boolean;
    /** True only when a platform subscription record contains an explicit tax component. */
    hasAuthoritativeBreakdown: boolean;
}): TaxEvidenceVerdict {
    const captured = input.capturedPaise;
    const refunded = input.refundedPaise ?? BigInt(0);
    if (captured <= BigInt(0) || refunded < BigInt(0) || refunded > captured)
        return "INVALID";
    if (!input.hasExisting)
        return input.hasAuthoritativeBreakdown ? "MANUAL_REVIEW_REQUIRED" : "MISSING";
    const tax = input.taxPaise;
    const refundedTax = input.refundedTaxPaise ?? BigInt(0);
    if (tax == null || tax < BigInt(0) || tax >= captured || refundedTax < BigInt(0) || refundedTax > tax || refundedTax > refunded)
        return "CONFLICT";
    const net = captured - tax;
    const refundedNet = refunded - refundedTax;
    if (refundedNet < BigInt(0) || refundedNet > net)
        return "CONFLICT";
    return "VERIFIED";
}

const PRODUCTION_HOST_MARKERS = ["hgacoeoovjxkzfbesmvl", "www.postbus.in", "postbus.in"];

function hostLooksLikeProduction(value?: string | null) {
    const host = (value ?? "").trim().toLowerCase();
    if (!host) return false;
    return PRODUCTION_HOST_MARKERS.some((marker) => host.includes(marker) && (marker !== "postbus.in" || !host.includes("auth-staging")));
}

/** Fails closed unless the caller names an approved staging project that is not production. */
export function assertAffiliateStagingTarget(input: {
    projectRef?: string | null;
    productionRefs: string[];
    approvedStagingRef?: string | null;
    databaseUrl?: string | null;
    supabaseUrl?: string | null;
    appUrl?: string | null;
    environmentName?: string | null;
    writeAuthorized?: string | null;
}) {
    const projectRef = input.projectRef?.trim() || "";
    const approved = input.approvedStagingRef?.trim() || "";
    if (!projectRef)
        return { ok: false as const, reason: "missing_project_ref" };
    if (input.productionRefs.some((ref) => ref.trim() === projectRef) || projectRef === "hgacoeoovjxkzfbesmvl")
        return { ok: false as const, reason: "production_project" };
    if (hostLooksLikeProduction(input.databaseUrl) || hostLooksLikeProduction(input.supabaseUrl) || hostLooksLikeProduction(input.appUrl))
        return { ok: false as const, reason: "production_hostname" };
    const environment = (input.environmentName ?? "").trim().toLowerCase();
    if (environment && environment !== "staging" && environment !== "affiliate-staging")
        return { ok: false as const, reason: "environment_not_staging" };
    if (!approved || approved !== projectRef)
        return { ok: false as const, reason: "staging_not_approved" };
    if ((input.writeAuthorized ?? "").trim() !== "AFFILIATE_STAGING_WRITE_APPROVED")
        return { ok: false as const, reason: "remote_write_not_authorized" };
    return { ok: true as const, reason: "approved_staging" };
}
