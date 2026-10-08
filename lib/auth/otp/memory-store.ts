import { applyOtpAttempt, type OtpChallengeRow, type OtpPurpose, type SignupPayload } from "@/lib/auth/otp/attempt";
import { otpHmacMatches } from "@/lib/auth/otp/crypto";
import type { OtpAuditEvent, OtpIssueInput, OtpIssueResult, OtpStore } from "@/lib/auth/otp/store";

export class MemoryOtpStore implements OtpStore {
  challenges: OtpChallengeRow[] = [];
  audits: OtpAuditEvent[] = [];
  private buckets = new Map<string, number>();
  private meta = new Map<string, { ipHash: string; userAgent: string }>();
  private lanes = new Map<string, Promise<void>>();

  private async withLane<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.lanes.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    this.lanes.set(key, previous.then(() => gate));
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async issueChallenge(input: OtpIssueInput): Promise<OtpIssueResult> {
    return this.withLane(`${input.phone}:${input.purpose}`, async () => {
      const sentAt = await this.latestPendingSentAt(input.phone, input.purpose);
      if (sentAt != null && input.nowMs - sentAt < input.cooldownMs) return "cooldown";
      const phoneCount = await this.consumeRate(input.phoneBucket, input.windowStartsAt);
      const ipCount = await this.consumeRate(input.ipBucket, input.windowStartsAt);
      if (phoneCount > input.phoneLimit || ipCount > input.ipLimit) return "rate_limited";
      await this.invalidateOpen(input.phone, input.purpose);
      await this.insertChallenge(
        {
          id: input.id,
          phoneE164: input.phone,
          purpose: input.purpose,
          otpHmac: input.otpHmac,
          expiresAtMs: input.expiresAtMs,
          attemptCount: 0,
          maxAttempts: input.maxAttempts,
          lastSentAtMs: input.nowMs,
          verifiedAtMs: null,
          status: "pending",
          signupPayload: input.signupPayload,
          createdAtMs: input.nowMs,
        },
        { ipHash: input.ipHash, userAgent: input.userAgent.slice(0, 160) }
      );
      return "issued";
    });
  }

  async latestPendingSentAt(phone: string, purpose: OtpPurpose) {
    const pending = this.challenges
      .filter((row) => row.phoneE164 === phone && row.purpose === purpose && row.status === "pending")
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
    return pending[0]?.lastSentAtMs ?? null;
  }

  async invalidateOpen(phone: string, purpose: OtpPurpose) {
    for (const row of this.challenges) {
      if (row.phoneE164 === phone && row.purpose === purpose && (row.status === "pending" || row.status === "verified")) {
        row.status = "invalidated";
      }
    }
  }

  async invalidateId(id: string) {
    const row = this.challenges.find((item) => item.id === id);
    if (row && row.status !== "consumed") row.status = "invalidated";
  }

  async insertChallenge(row: OtpChallengeRow, meta: { ipHash: string; userAgent: string }) {
    this.challenges.push({ ...row });
    this.meta.set(row.id, meta);
  }

  async attempt(input: { id: string; phone: string; purpose: OtpPurpose; hmac: string; nowMs: number }) {
    const index = this.challenges.findIndex(
      (row) => row.id === input.id && row.phoneE164 === input.phone && row.purpose === input.purpose
    );
    const current = index >= 0 ? this.challenges[index] : null;
    const result = applyOtpAttempt(current, input.nowMs, current ? otpHmacMatches(input.hmac, current.otpHmac) : false);
    if (result.row && index >= 0) this.challenges[index] = result.row;
    return result.outcome;
  }

  async get(id: string, phone: string, purpose: OtpPurpose) {
    const row = this.challenges.find((item) => item.id === id && item.phoneE164 === phone && item.purpose === purpose);
    return row ? { ...row, signupPayload: row.signupPayload ? { ...row.signupPayload } : null } : null;
  }

  async saveSignupPayload(id: string, payload: SignupPayload) {
    const row = this.challenges.find((item) => item.id === id);
    if (!row) throw new Error("missing challenge");
    if (!row.signupPayload) row.signupPayload = { ...payload };
    return { ...row.signupPayload };
  }

  async markConsumed(id: string) {
    const row = this.challenges.find((item) => item.id === id);
    if (row?.status === "verified") row.status = "consumed";
  }

  async consumeRate(bucketKey: string, windowStartsAt: Date) {
    const key = `${bucketKey}|${windowStartsAt.toISOString()}`;
    const next = (this.buckets.get(key) ?? 0) + 1;
    this.buckets.set(key, next);
    return next;
  }

  async audit(event: OtpAuditEvent) {
    this.audits.push(event);
  }
}
