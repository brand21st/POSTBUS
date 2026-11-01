/** GST-inclusive subscription math. A rate is authoritative only when an approved policy supplies it. */

export type TaxPolicyStatus = "DRAFT" | "APPROVED" | "RETIRED";
export type TaxVerdict = "APPROVED" | "MISSING_CONFIGURATION" | "UNSUPPORTED_TAX_TREATMENT" | "REVIEW_REQUIRED" | "CONFLICT";

export type TaxPolicyRecord = {
    id: string;
    version: number;
    status: TaxPolicyStatus;
    pricesIncludeTax: boolean;
    treatment: string;
    rateBasisPoints: number | null;
    placeOfSupply: "INTRA" | "INTER" | null;
    effectiveAt: string;
};

export type InclusiveBreakdown = {
    grossPaise: bigint;
    taxablePaise: bigint;
    taxPaise: bigint;
    cgstPaise: bigint;
    sgstPaise: bigint;
    igstPaise: bigint;
};

/** Off unless explicitly enabled. Does not change checkout amounts. */
export const billingTaxAutomationEnabled = () => process.env.POSTBUS_BILLING_TAX_AUTOMATION_ENABLED === "true";

/** Off unless explicitly enabled. The public price remains the configured plan amount either way. */
export const gstInclusiveLabelEnabled = () => process.env.POSTBUS_BILLING_GST_INCLUSIVE_LABEL === "true";

export function splitInclusiveTax(grossPaise: bigint, rateBasisPoints: bigint) {
    if (grossPaise <= BigInt(0) || rateBasisPoints <= BigInt(0) || rateBasisPoints >= BigInt(10000))
        throw new Error("Inclusive tax inputs are not approvable");
    const divisor = BigInt(10000) + rateBasisPoints;
    const taxablePaise = (grossPaise * BigInt(10000) + divisor / BigInt(2)) / divisor;
    const taxPaise = grossPaise - taxablePaise;
    if (taxablePaise <= BigInt(0) || taxPaise <= BigInt(0) || taxablePaise + taxPaise !== grossPaise)
        throw new Error("Inclusive tax did not reconcile");
    return { taxablePaise, taxPaise };
}

export function allocateGst(taxPaise: bigint, placeOfSupply: "INTRA" | "INTER") {
    if (taxPaise < BigInt(0))
        throw new Error("Tax cannot be negative");
    if (placeOfSupply === "INTER")
        return { cgstPaise: BigInt(0), sgstPaise: BigInt(0), igstPaise: taxPaise };
    const cgstPaise = taxPaise / BigInt(2);
    return { cgstPaise, sgstPaise: taxPaise - cgstPaise, igstPaise: BigInt(0) };
}

export function refundedTaxPaise(taxPaise: bigint, grossPaise: bigint, refundedPaise: bigint) {
    if (taxPaise < BigInt(0) || grossPaise <= BigInt(0) || refundedPaise < BigInt(0) || refundedPaise > grossPaise)
        throw new Error("Refunded tax inputs are invalid");
    if (taxPaise === BigInt(0) || refundedPaise === BigInt(0))
        return BigInt(0);
    const refunded = (taxPaise * refundedPaise + grossPaise / BigInt(2)) / grossPaise;
    if (refunded > taxPaise || refunded > refundedPaise)
        throw new Error("Refunded tax did not reconcile");
    return refunded;
}

export function resolveApplicableSubscriptionTax(input: {
    transactionAt: string;
    currency: string;
    grossPaise: bigint;
    policies: TaxPolicyRecord[];
}) {
    const empty = { policy: null as TaxPolicyRecord | null, breakdown: null as InclusiveBreakdown | null };
    if (input.currency !== "INR" || input.grossPaise <= BigInt(0))
        return { verdict: "UNSUPPORTED_TAX_TREATMENT" as const, ...empty };
    const transactionAt = Date.parse(input.transactionAt);
    if (!Number.isFinite(transactionAt))
        return { verdict: "REVIEW_REQUIRED" as const, ...empty };
    const eligible = input.policies.filter((policy) => policy.status === "APPROVED" && Date.parse(policy.effectiveAt) <= transactionAt);
    if (!eligible.length)
        return { verdict: "MISSING_CONFIGURATION" as const, ...empty };
    eligible.sort((left, right) => Date.parse(right.effectiveAt) - Date.parse(left.effectiveAt) || right.version - left.version);
    const policy = eligible[0];
    if (eligible.some((item) => item.id !== policy.id && item.effectiveAt === policy.effectiveAt && item.version === policy.version))
        return { verdict: "CONFLICT" as const, ...empty };
    if (!policy.pricesIncludeTax)
        return { verdict: "UNSUPPORTED_TAX_TREATMENT" as const, policy, breakdown: null };
    if (policy.treatment === "ZERO_RATED") {
        if (policy.rateBasisPoints !== 0)
            return { verdict: "REVIEW_REQUIRED" as const, policy, breakdown: null };
        return {
            verdict: "APPROVED" as const,
            policy,
            breakdown: { grossPaise: input.grossPaise, taxablePaise: input.grossPaise, taxPaise: BigInt(0), cgstPaise: BigInt(0), sgstPaise: BigInt(0), igstPaise: BigInt(0) },
        };
    }
    if (policy.treatment !== "SINGLE_RATE_INCLUSIVE" || policy.rateBasisPoints == null || policy.rateBasisPoints <= 0 || policy.rateBasisPoints >= 10000 || (policy.placeOfSupply !== "INTRA" && policy.placeOfSupply !== "INTER"))
        return { verdict: "REVIEW_REQUIRED" as const, policy, breakdown: null };
    try {
        const split = splitInclusiveTax(input.grossPaise, BigInt(policy.rateBasisPoints));
        const parts = allocateGst(split.taxPaise, policy.placeOfSupply);
        if (split.taxablePaise + split.taxPaise !== input.grossPaise || parts.cgstPaise + parts.sgstPaise + parts.igstPaise !== split.taxPaise)
            return { verdict: "REVIEW_REQUIRED" as const, policy, breakdown: null };
        return { verdict: "APPROVED" as const, policy, breakdown: { grossPaise: input.grossPaise, ...split, ...parts } };
    }
    catch {
        return { verdict: "REVIEW_REQUIRED" as const, policy, breakdown: null };
    }
}
