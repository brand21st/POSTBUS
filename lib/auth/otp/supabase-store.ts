import type { SupabaseClient } from "@supabase/supabase-js";
import type { OtpChallengeRow, OtpPurpose, SignupPayload } from "@/lib/auth/otp/attempt";
import type { OtpAuditEvent, OtpIssueResult, OtpStore } from "@/lib/auth/otp/store";

type ChallengeDb = {
  id: string;
  phone_e164: string;
  purpose: OtpPurpose;
  otp_hmac: string;
  expires_at: string;
  attempt_count: number;
  max_attempts: number;
  last_sent_at: string;
  verified_at: string | null;
  status: OtpChallengeRow["status"];
  signup_payload: { name?: string; business_name?: string; email?: string } | null;
  created_at: string;
};

function payloadFromDb(value: ChallengeDb["signup_payload"]): SignupPayload | null {
  if (!value?.name || !value.business_name || !value.email) return null;
  return { name: value.name, businessName: value.business_name, email: value.email };
}

function rowFromDb(row: ChallengeDb): OtpChallengeRow {
  return {
    id: row.id,
    phoneE164: row.phone_e164,
    purpose: row.purpose,
    otpHmac: row.otp_hmac,
    expiresAtMs: new Date(row.expires_at).getTime(),
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    lastSentAtMs: new Date(row.last_sent_at).getTime(),
    verifiedAtMs: row.verified_at ? new Date(row.verified_at).getTime() : null,
    status: row.status,
    signupPayload: payloadFromDb(row.signup_payload),
    createdAtMs: new Date(row.created_at).getTime(),
  };
}

export function createSupabaseOtpStore(admin: SupabaseClient): OtpStore {
  return {
    async issueChallenge(input) {
      const { data, error } = await admin.rpc("issue_otp_challenge", {
        p_id: input.id,
        p_phone: input.phone,
        p_purpose: input.purpose,
        p_hmac: input.otpHmac,
        p_expires_at: new Date(input.expiresAtMs).toISOString(),
        p_now: new Date(input.nowMs).toISOString(),
        p_max_attempts: input.maxAttempts,
        p_signup: input.signupPayload
          ? {
              name: input.signupPayload.name,
              business_name: input.signupPayload.businessName,
              email: input.signupPayload.email,
            }
          : null,
        p_ip_hash: input.ipHash,
        p_user_agent: input.userAgent,
        p_phone_bucket: input.phoneBucket,
        p_ip_bucket: input.ipBucket,
        p_window_starts_at: input.windowStartsAt.toISOString(),
        p_phone_limit: input.phoneLimit,
        p_ip_limit: input.ipLimit,
        p_cooldown_ms: input.cooldownMs,
      });
      if (error) throw new Error(error.message);
      const result = String(data);
      if (result === "issued" || result === "cooldown" || result === "rate_limited") {
        return result as OtpIssueResult;
      }
      throw new Error("unexpected otp issue result");
    },
    async latestPendingSentAt(phone, purpose) {
      const { data, error } = await admin
        .from("otp_challenges")
        .select("last_sent_at")
        .eq("phone_e164", phone)
        .eq("purpose", purpose)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.last_sent_at ? new Date(data.last_sent_at).getTime() : null;
    },
    async invalidateOpen(phone, purpose) {
      const { error } = await admin
        .from("otp_challenges")
        .update({ status: "invalidated" })
        .eq("phone_e164", phone)
        .eq("purpose", purpose)
        .in("status", ["pending", "verified"]);
      if (error) throw new Error(error.message);
    },
    async invalidateId(id) {
      const { error } = await admin
        .from("otp_challenges")
        .update({ status: "invalidated" })
        .eq("id", id)
        .neq("status", "consumed");
      if (error) throw new Error(error.message);
    },
    async insertChallenge(row, meta) {
      const { error } = await admin.from("otp_challenges").insert({
        id: row.id,
        phone_e164: row.phoneE164,
        purpose: row.purpose,
        otp_hmac: row.otpHmac,
        expires_at: new Date(row.expiresAtMs).toISOString(),
        attempt_count: row.attemptCount,
        max_attempts: row.maxAttempts,
        last_sent_at: new Date(row.lastSentAtMs).toISOString(),
        verified_at: null,
        status: row.status,
        signup_payload: row.signupPayload
          ? {
              name: row.signupPayload.name,
              business_name: row.signupPayload.businessName,
              email: row.signupPayload.email,
            }
          : null,
        ip_hash: meta.ipHash,
        user_agent: meta.userAgent,
        created_at: new Date(row.createdAtMs).toISOString(),
      });
      if (error) throw new Error(error.message);
    },
    async attempt(input) {
      const { data, error } = await admin.rpc("verify_otp_challenge", {
        p_id: input.id,
        p_phone: input.phone,
        p_purpose: input.purpose,
        p_hmac: input.hmac,
      });
      if (error) throw new Error(error.message);
      const outcome = String(data);
      if (
        outcome === "missing" ||
        outcome === "locked" ||
        outcome === "expired" ||
        outcome === "mismatch" ||
        outcome === "matched"
      ) {
        return outcome;
      }
      throw new Error("unexpected otp outcome");
    },
    async get(id, phone, purpose) {
      const { data, error } = await admin
        .from("otp_challenges")
        .select(
          "id, phone_e164, purpose, otp_hmac, expires_at, attempt_count, max_attempts, last_sent_at, verified_at, status, signup_payload, created_at"
        )
        .eq("id", id)
        .eq("phone_e164", phone)
        .eq("purpose", purpose)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const row = rowFromDb(data as ChallengeDb);
      row.otpHmac = "";
      return row;
    },
    async saveSignupPayload(id, payload) {
      const { data, error } = await admin
        .from("otp_challenges")
        .update({
          signup_payload: {
            name: payload.name,
            business_name: payload.businessName,
            email: payload.email,
          },
        })
        .eq("id", id)
        .is("signup_payload", null)
        .select("signup_payload")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data?.signup_payload) return payloadFromDb(data.signup_payload as ChallengeDb["signup_payload"]) ?? payload;
      const existing = await admin.from("otp_challenges").select("signup_payload").eq("id", id).maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      return payloadFromDb(existing.data?.signup_payload as ChallengeDb["signup_payload"]) ?? payload;
    },
    async markConsumed(id) {
      const { error } = await admin.from("otp_challenges").update({ status: "consumed" }).eq("id", id).eq("status", "verified");
      if (error) throw new Error(error.message);
    },
    async consumeRate(bucketKey, windowStartsAt) {
      const { data, error } = await admin.rpc("consume_otp_rate_bucket", {
        p_bucket_key: bucketKey,
        p_window_starts_at: windowStartsAt.toISOString(),
      });
      if (error) throw new Error(error.message);
      return Number(data);
    },
    async audit(event: OtpAuditEvent) {
      const { error } = await admin.from("auth_audit_events").insert({
        event: event.event,
        phone_last4: event.phoneLast4,
        purpose: event.purpose,
        ip_hash: event.ipHash,
        outcome: event.outcome,
        error_code: event.errorCode ?? null,
      });
      if (error) throw new Error(error.message);
    },
  };
}
