import { z } from "zod";
export const affiliateEnabled = () => process.env.POSTBUS_AFFILIATES_ENABLED === "true";
/** Public referral codes are opaque 24-character tokens, never table UUIDs. */
export function isPublicReferralCode(code: string) {
    return /^[a-zA-Z0-9_-]{24}$/.test(code);
}
/** Format integer paise as INR without floating-point money math. */
export function formatPaiseInr(value: unknown) {
    const n = BigInt(String(value ?? 0));
    const abs = n < BigInt(0) ? -n : n;
    return `${n < BigInt(0) ? "−" : ""}₹${(abs / BigInt(100)).toLocaleString("en-IN")}.${(abs % BigInt(100)).toString().padStart(2, "0")}`;
}
export function formatBasisPoints(basisPoints: number) {
    const whole = Math.trunc(basisPoints / 100);
    const fraction = Math.abs(basisPoints % 100);
    return fraction ? `${whole}.${String(fraction).padStart(2, "0")}%` : `${whole}%`;
}
export const accrualEnabled = () => affiliateEnabled() && process.env.POSTBUS_AFFILIATE_ACCRUAL_ENABLED === "true";
export const payoutsEnabled = () => affiliateEnabled() && process.env.POSTBUS_AFFILIATE_PAYOUTS_ENABLED === "true";
export const paise = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const PARTNER_LANDING_PATHS = ["/", "/pricing", "/partner"] as const;
export const campaignLinkSchema = z.object({
    campaign: z.string().trim().min(1).max(80).regex(/^[\w -]+$/),
    channel: z.string().trim().max(80).regex(/^[\w -]*$/).default(""),
    utmSource: z.string().trim().max(80).regex(/^[\w.-]*$/).default(""),
    utmMedium: z.string().trim().max(80).regex(/^[\w.-]*$/).default(""),
    utmCampaign: z.string().trim().max(80).regex(/^[\w.-]*$/).default(""),
    landingPath: z.enum(PARTNER_LANDING_PATHS).default("/"),
}).strict();
export function publicReferralPath(code: string, landingPath = "/", utm: { utmSource?: string; utmMedium?: string; utmCampaign?: string } = {}) {
    const params = new URLSearchParams({ ref: code });
    if (utm.utmSource) params.set("utm_source", utm.utmSource);
    if (utm.utmMedium) params.set("utm_medium", utm.utmMedium);
    if (utm.utmCampaign) params.set("utm_campaign", utm.utmCampaign);
    return `${landingPath}?${params.toString()}`;
}
export const applicationSchema = z.object({
    fullName: z.string().trim().min(2).max(120), mobile: z.string().regex(/^\+?[0-9]{8,15}$/),
    business: z.string().trim().max(150).default(""), website: z.union([z.literal(""), z.url()]).default(""),
    social: z.string().max(250).default(""), channel: z.string().trim().min(2).max(120),
    country: z.literal("IN"), state: z.string().trim().min(2).max(80), city: z.string().trim().min(2).max(80),
    terms: z.literal(true),
    notify: z.boolean().default(true),
}).strict();
/** All intermediate arithmetic is integer, including cumulative refund rounding. */
export function commissionPaise(net: bigint, basisPoints: bigint, fixed?: bigint) {
    if (net < BigInt(0) || basisPoints < BigInt(0) || basisPoints > BigInt(10000) || (fixed != null && fixed < BigInt(0)))
        throw new Error("Invalid commission inputs");
    return fixed == null ? (net * basisPoints + BigInt(5000)) / BigInt(10000) : (fixed < net ? fixed : net);
}
export function reversalPaise(original: bigint, originalNet: bigint, refundedNet: bigint) {
    if (original < BigInt(0) || originalNet <= BigInt(0) || refundedNet < BigInt(0) || refundedNet > originalNet)
        throw new Error("Invalid refund inputs");
    return (original * refundedNet + originalNet / BigInt(2)) / originalNet;
}
export function eligibleCapture(payment: Record<string, unknown>, expected: {
    paymentId: string;
    orderId: string;
    currency: string;
}) {
    return payment.id === expected.paymentId && payment.order_id === expected.orderId &&
        (payment.status === "captured" || (payment.status === "refunded" && payment.amount_refunded === payment.amount)) && payment.captured === true && payment.currency === expected.currency &&
        expected.currency === "INR" && Number.isSafeInteger(payment.amount) && Number(payment.amount) > 0 &&
        Number.isSafeInteger(payment.amount_refunded) && Number(payment.amount_refunded) >= 0 && Number(payment.amount_refunded) <= Number(payment.amount);
}
