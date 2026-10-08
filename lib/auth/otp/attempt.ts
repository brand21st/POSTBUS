export type OtpPurpose = "LOGIN" | "SIGNUP" | "PHONE_VERIFICATION" | "SENSITIVE_ACTION";
export type OtpStatus = "pending" | "verified" | "expired" | "consumed" | "invalidated";
export type OtpAttemptOutcome = "missing" | "locked" | "expired" | "mismatch" | "matched";

export type SignupPayload = {
  name: string;
  businessName: string;
  email: string;
};

export type OtpChallengeRow = {
  id: string;
  phoneE164: string;
  purpose: OtpPurpose;
  otpHmac: string;
  expiresAtMs: number;
  attemptCount: number;
  maxAttempts: number;
  lastSentAtMs: number;
  verifiedAtMs: number | null;
  status: OtpStatus;
  signupPayload: SignupPayload | null;
  createdAtMs: number;
};

/** Single-use attempt transition. The SQL function verify_otp_challenge mirrors this. */
export function applyOtpAttempt(
  row: OtpChallengeRow | null,
  nowMs: number,
  hmacMatches: boolean
): { outcome: OtpAttemptOutcome; row: OtpChallengeRow | null } {
  if (!row) return { outcome: "missing", row: null };
  if (row.status === "invalidated" && row.attemptCount >= row.maxAttempts) {
    return { outcome: "locked", row };
  }
  if (row.status !== "pending") return { outcome: "expired", row };
  if (row.expiresAtMs <= nowMs) {
    return { outcome: "expired", row: { ...row, status: "expired" } };
  }
  if (row.attemptCount >= row.maxAttempts) {
    return { outcome: "locked", row: { ...row, status: "invalidated" } };
  }

  const attemptCount = row.attemptCount + 1;
  if (hmacMatches) {
    return {
      outcome: "matched",
      row: { ...row, attemptCount, status: "verified", verifiedAtMs: nowMs },
    };
  }
  if (attemptCount >= row.maxAttempts) {
    return { outcome: "mismatch", row: { ...row, attemptCount, status: "invalidated" } };
  }
  return { outcome: "mismatch", row: { ...row, attemptCount, status: "pending" } };
}
