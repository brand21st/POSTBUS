import type { OtpAttemptOutcome, OtpChallengeRow, OtpPurpose, SignupPayload } from "@/lib/auth/otp/attempt";

export type OtpAuditEvent = {
  event: string;
  phoneLast4: string;
  purpose: OtpPurpose;
  ipHash: string;
  outcome: string;
  errorCode?: string | null;
};

export type OtpIssueInput = {
  id: string;
  phone: string;
  purpose: OtpPurpose;
  otpHmac: string;
  expiresAtMs: number;
  nowMs: number;
  maxAttempts: number;
  signupPayload: SignupPayload | null;
  ipHash: string;
  userAgent: string;
  phoneBucket: string;
  ipBucket: string;
  windowStartsAt: Date;
  phoneLimit: number;
  ipLimit: number;
  cooldownMs: number;
};

export type OtpIssueResult = "issued" | "cooldown" | "rate_limited";

export type OtpStore = {
  issueChallenge(input: OtpIssueInput): Promise<OtpIssueResult>;
  latestPendingSentAt(phone: string, purpose: OtpPurpose): Promise<number | null>;
  invalidateOpen(phone: string, purpose: OtpPurpose): Promise<void>;
  invalidateId(id: string): Promise<void>;
  insertChallenge(row: OtpChallengeRow, meta: { ipHash: string; userAgent: string }): Promise<void>;
  attempt(input: {
    id: string;
    phone: string;
    purpose: OtpPurpose;
    hmac: string;
    nowMs: number;
  }): Promise<OtpAttemptOutcome>;
  get(id: string, phone: string, purpose: OtpPurpose): Promise<OtpChallengeRow | null>;
  saveSignupPayload(id: string, payload: SignupPayload): Promise<SignupPayload>;
  markConsumed(id: string): Promise<void>;
  consumeRate(bucketKey: string, windowStartsAt: Date): Promise<number>;
  audit(event: OtpAuditEvent): Promise<void>;
};
