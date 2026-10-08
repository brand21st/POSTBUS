import { randomUUID } from "crypto";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { toIndiaWhatsappE164 } from "@/lib/phone/india-whatsapp";
import type { OtpPurpose, SignupPayload } from "@/lib/auth/otp/attempt";
import { generateOtpDigits, hashIp, hashOtp, phoneLast4 } from "@/lib/auth/otp/crypto";
import {
  OTP_IP_SEND_LIMIT,
  OTP_MAX_ATTEMPTS,
  OTP_MESSAGES,
  OTP_PHONE_SEND_LIMIT,
  OTP_PROFILE_WINDOW_MS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  sendWindowStart,
} from "@/lib/auth/otp/policy";
import type { OtpStore } from "@/lib/auth/otp/store";

export type PhoneIdentity =
  | { kind: "unique"; userId: string; email: string }
  | { kind: "none" }
  | { kind: "duplicate" }
  | { kind: "error"; reason: "LOOKUP_FAILED" | "MISSING_EMAIL" };

export type OtpDeps = {
  now: () => number;
  pepper: string;
  store: OtpStore;
  send: (phone: string, otp: string) => Promise<void>;
  resolveIdentity: (phone: string) => Promise<PhoneIdentity>;
  createUser: (input: SignupPayload & { phone: string }) => Promise<{ userId: string; email: string }>;
  linkIdentity: (phone: string, userId: string) => Promise<void>;
  mint: (email: string) => Promise<{ userId: string; session: unknown }>;
  ensureWorkspace: (input: {
    session: unknown;
    userId: string;
    workspaceName: string | null;
    fullName: string | null;
    email: string;
  }) => Promise<void>;
};

export type OtpRequestInput = {
  phone: string;
  purpose: Extract<OtpPurpose, "LOGIN" | "SIGNUP">;
  signup?: SignupPayload | null;
  ip: string;
  userAgent: string;
};

function phoneOrThrow(value: string) {
  try {
    return toIndiaWhatsappE164(value);
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, OTP_MESSAGES.phone);
  }
}

function waitError() {
  return new AppError(ERROR_CODES.RATE_LIMITED, OTP_MESSAGES.wait);
}

function invalidError() {
  return new AppError(ERROR_CODES.VALIDATION_ERROR, OTP_MESSAGES.invalid);
}

function lockedError() {
  return new AppError(ERROR_CODES.VALIDATION_ERROR, OTP_MESSAGES.locked);
}

async function writeAudit(
  store: OtpStore,
  event: Parameters<OtpStore["audit"]>[0]
) {
  try {
    await store.audit(event);
  } catch (error) {
    logError("otp.audit_failed", {
      message: error instanceof Error ? error.message : "audit",
    });
  }
}

export async function requestOtp(deps: OtpDeps, input: OtpRequestInput) {
  const phone = phoneOrThrow(input.phone);
  const nowMs = deps.now();
  const ipHash = hashIp(deps.pepper, input.ip);
  const last4 = phoneLast4(phone);
  const otp = generateOtpDigits();
  const id = randomUUID();
  const issued = await deps.store.issueChallenge({
    id,
    phone,
    purpose: input.purpose,
    otpHmac: hashOtp(deps.pepper, input.purpose, phone, otp),
    expiresAtMs: nowMs + OTP_TTL_MS,
    nowMs,
    maxAttempts: OTP_MAX_ATTEMPTS,
    signupPayload: input.purpose === "SIGNUP" ? input.signup ?? null : null,
    ipHash,
    userAgent: input.userAgent,
    phoneBucket: `phone:${phone}`,
    ipBucket: `ip:${ipHash}`,
    windowStartsAt: sendWindowStart(nowMs),
    phoneLimit: OTP_PHONE_SEND_LIMIT,
    ipLimit: OTP_IP_SEND_LIMIT,
    cooldownMs: OTP_RESEND_COOLDOWN_MS,
  });
  if (issued !== "issued") throw waitError();
  await writeAudit(deps.store, {
    event: "OTP_REQUESTED",
    phoneLast4: last4,
    purpose: input.purpose,
    ipHash,
    outcome: "accepted",
  });

  try {
    await deps.send(phone, otp);
  } catch (error) {
    await deps.store.invalidateId(id);
    await writeAudit(deps.store, {
      event: "OTP_SEND_FAILED",
      phoneLast4: last4,
      purpose: input.purpose,
      ipHash,
      outcome: "failed",
      errorCode: "SEND_FAILED",
    });
    logError("otp.send_failed", {
      message: error instanceof Error ? error.message : "send",
    });
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, OTP_MESSAGES.sendFailed);
  }

  await writeAudit(deps.store, {
    event: "OTP_SENT",
    phoneLast4: last4,
    purpose: input.purpose,
    ipHash,
    outcome: "sent",
  });

  return {
    status: "sent" as const,
    challengeId: id,
    expiresInSeconds: OTP_TTL_MS / 1000,
    resendAfterSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
  };
}

async function openSession(
  deps: OtpDeps,
  input: {
    challengeId: string;
    phone: string;
    purpose: OtpPurpose;
    ipHash: string;
    identity: Extract<PhoneIdentity, { kind: "unique" }>;
    workspaceName: string | null;
    fullName: string | null;
    linkFirst: boolean;
  }
) {
  if (input.linkFirst) {
    try {
      await deps.linkIdentity(input.phone, input.identity.userId);
    } catch (error) {
      if (error instanceof Error && error.message === "DUPLICATE_PHONE") {
        await writeAudit(deps.store, {
          event: "LOGIN_FAILED",
          phoneLast4: phoneLast4(input.phone),
          purpose: input.purpose,
          ipHash: input.ipHash,
          outcome: "failed",
          errorCode: "DUPLICATE_PHONE_IDENTITY",
        });
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, OTP_MESSAGES.duplicatePhone);
      }
      throw error;
    }
  }
  try {
    const minted = await deps.mint(input.identity.email);
    await deps.ensureWorkspace({
      session: minted.session,
      userId: input.identity.userId,
      workspaceName: input.workspaceName,
      fullName: input.fullName,
      email: input.identity.email,
    });
  } catch (error) {
    logError("otp.session_failed", {
      message: error instanceof Error ? error.message : "session",
    });
    await writeAudit(deps.store, {
      event: "LOGIN_FAILED",
      phoneLast4: phoneLast4(input.phone),
      purpose: input.purpose,
      ipHash: input.ipHash,
      outcome: "failed",
      errorCode: "SESSION_FAILED",
    });
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, OTP_MESSAGES.signInFailed);
  }
  await deps.store.markConsumed(input.challengeId);
  await writeAudit(deps.store, {
    event: "LOGIN_SUCCESS",
    phoneLast4: phoneLast4(input.phone),
    purpose: input.purpose,
    ipHash: input.ipHash,
    outcome: "ok",
  });
  await writeAudit(deps.store, {
    event: "SESSION_CREATED",
    phoneLast4: phoneLast4(input.phone),
    purpose: input.purpose,
    ipHash: input.ipHash,
    outcome: "ok",
  });
  return { status: "authenticated" as const };
}

async function establish(
  deps: OtpDeps,
  input: {
    challengeId: string;
    phone: string;
    purpose: OtpPurpose;
    ipHash: string;
    payload: SignupPayload | null;
  }
) {
  const identity = await deps.resolveIdentity(input.phone);
  if (identity.kind === "duplicate" || identity.kind === "error") {
    await writeAudit(deps.store, {
      event: "LOGIN_FAILED",
      phoneLast4: phoneLast4(input.phone),
      purpose: input.purpose,
      ipHash: input.ipHash,
      outcome: "failed",
      errorCode: identity.kind === "duplicate" ? "DUPLICATE_PHONE_IDENTITY" : identity.reason,
    });
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, OTP_MESSAGES.duplicatePhone);
  }

  if (identity.kind === "unique") {
    return openSession(deps, {
      ...input,
      identity,
      workspaceName: input.payload?.businessName ?? null,
      fullName: input.payload?.name ?? null,
      linkFirst: true,
    });
  }

  if (!input.payload) {
    return { status: "complete_profile" as const, challengeId: input.challengeId };
  }

  let created: { userId: string; email: string };
  try {
    created = await deps.createUser({ ...input.payload, phone: input.phone });
  } catch (error) {
    const code = error instanceof Error && error.message === "EMAIL_TAKEN" ? "DUPLICATE_EMAIL" : "CREATE_FAILED";
    await writeAudit(deps.store, {
      event: "LOGIN_FAILED",
      phoneLast4: phoneLast4(input.phone),
      purpose: input.purpose,
      ipHash: input.ipHash,
      outcome: "failed",
      errorCode: code,
    });
    if (code === "DUPLICATE_EMAIL") {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, OTP_MESSAGES.duplicateEmail);
    }
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, OTP_MESSAGES.signInFailed);
  }

  await writeAudit(deps.store, {
    event: "ACCOUNT_CREATED",
    phoneLast4: phoneLast4(input.phone),
    purpose: input.purpose,
    ipHash: input.ipHash,
    outcome: "ok",
  });

  return openSession(deps, {
    ...input,
    identity: { kind: "unique", userId: created.userId, email: created.email },
    workspaceName: input.payload.businessName,
    fullName: input.payload.name,
    linkFirst: true,
  });
}

export async function verifyOtp(
  deps: OtpDeps,
  input: {
    challengeId: string;
    phone: string;
    purpose: Extract<OtpPurpose, "LOGIN" | "SIGNUP">;
    otp?: string | null;
    profile?: SignupPayload | null;
    ip: string;
    userAgent: string;
  }
) {
  const phone = phoneOrThrow(input.phone);
  const nowMs = deps.now();
  const ipHash = hashIp(deps.pepper, input.ip);

  if (input.otp) {
    const outcome = await deps.store.attempt({
      id: input.challengeId,
      phone,
      purpose: input.purpose,
      hmac: hashOtp(deps.pepper, input.purpose, phone, input.otp),
      nowMs,
    });
    if (outcome === "locked") {
      await writeAudit(deps.store, {
        event: "OTP_VERIFICATION_FAILED",
        phoneLast4: phoneLast4(phone),
        purpose: input.purpose,
        ipHash,
        outcome: "failed",
        errorCode: "LOCKED",
      });
      throw lockedError();
    }
    if (outcome !== "matched") {
      await writeAudit(deps.store, {
        event: "OTP_VERIFICATION_FAILED",
        phoneLast4: phoneLast4(phone),
        purpose: input.purpose,
        ipHash,
        outcome: "failed",
        errorCode: "INVALID",
      });
      throw invalidError();
    }
    await writeAudit(deps.store, {
      event: "OTP_VERIFIED",
      phoneLast4: phoneLast4(phone),
      purpose: input.purpose,
      ipHash,
      outcome: "ok",
    });
  }

  const challenge = await deps.store.get(input.challengeId, phone, input.purpose);
  if (!challenge || challenge.status === "consumed" || challenge.status === "invalidated" || challenge.status === "expired") {
    throw invalidError();
  }
  if (challenge.status !== "verified") throw invalidError();
  if (challenge.verifiedAtMs == null || nowMs - challenge.verifiedAtMs > OTP_PROFILE_WINDOW_MS) {
    throw invalidError();
  }

  let payload = challenge.signupPayload;
  if (!payload && input.profile && input.purpose === "LOGIN") {
    payload = await deps.store.saveSignupPayload(input.challengeId, input.profile);
  }

  return establish(deps, {
    challengeId: input.challengeId,
    phone,
    purpose: input.purpose,
    ipHash,
    payload,
  });
}
