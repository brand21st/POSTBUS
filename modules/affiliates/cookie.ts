import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
export const REFERRAL_COOKIE = "pb_referral";
export type ReferralCookie = {
    link: string;
    visitor: string;
    expires: number;
};
function secret() {
    const key = process.env.POSTBUS_AFFILIATE_COOKIE_SECRET;
    if (!key || key.length < 32)
        throw new Error("Affiliate cookie signing is not configured");
    return key;
}
export function signReferral(value: ReferralCookie) {
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${payload}.${createHmac("sha256", secret()).update(payload).digest("base64url")}`;
}
export function readReferral(raw?: string, now = Date.now()): ReferralCookie | null {
    if (!raw || raw.length > 1024)
        return null;
    try {
        const [payload, mac, extra] = raw.split(".");
        if (extra || !mac)
            return null;
        const actual = Buffer.from(mac, "base64url");
        const expected = createHmac("sha256", secret()).update(payload).digest();
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
            return null;
        const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as ReferralCookie;
        return /^[0-9a-f-]{36}$/.test(value.link) && /^[0-9a-f]{32}$/.test(value.visitor) &&
            Number.isSafeInteger(value.expires) && value.expires > now ? value : null;
    }
    catch {
        return null;
    }
}
export const visitorId = () => randomBytes(16).toString("hex");
