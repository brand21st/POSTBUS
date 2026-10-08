import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PhoneIdentity } from "@/lib/auth/otp/service";

export function whatsappAuthUserPayload(input: { email: string; phoneE164: string; fullName: string }) {
  return {
    email: input.email.trim().toLowerCase(),
    password: randomBytes(32).toString("base64url"),
    email_confirm: false as const,
    phone: input.phoneE164,
    phone_confirm: true as const,
    user_metadata: {
      full_name: input.fullName.trim(),
      whatsapp_number: input.phoneE164,
    },
  };
}

export function isAuthEmailTaken(error: { message?: string; code?: string }) {
  const blob = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return blob.includes("email_exists") || (blob.includes("email") && /already|exists|registered|duplicate/.test(blob));
}

export async function resolvePhoneIdentity(admin: SupabaseClient, phone: string): Promise<PhoneIdentity> {
  const mapped = await admin.from("phone_identities").select("user_id").eq("phone_e164", phone).maybeSingle();
  if (mapped.error) return { kind: "error", reason: "LOOKUP_FAILED" };
  if (mapped.data?.user_id) {
    return identityForUser(admin, mapped.data.user_id);
  }

  const profiles = await admin.from("profiles").select("id").eq("whatsapp_number", phone);
  if (profiles.error) return { kind: "error", reason: "LOOKUP_FAILED" };
  const rows = profiles.data ?? [];
  if (rows.length > 1) return { kind: "duplicate" };
  if (rows.length === 0) return { kind: "none" };
  return identityForUser(admin, rows[0].id);
}

async function identityForUser(admin: SupabaseClient, userId: string): Promise<PhoneIdentity> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return { kind: "error", reason: "LOOKUP_FAILED" };
  const email = data.user.email?.trim();
  if (!email) return { kind: "error", reason: "MISSING_EMAIL" };
  return { kind: "unique", userId: data.user.id, email };
}

export async function linkPhoneIdentity(admin: SupabaseClient, phone: string, userId: string) {
  const inserted = await admin.from("phone_identities").insert({
    phone_e164: phone,
    user_id: userId,
    verified_at: new Date().toISOString(),
  });
  if (!inserted.error) return;
  if (inserted.error.code !== "23505") throw new Error(inserted.error.message);

  const byPhone = await admin.from("phone_identities").select("user_id").eq("phone_e164", phone).maybeSingle();
  if (byPhone.error) throw new Error(byPhone.error.message);
  if (byPhone.data?.user_id === userId) return;
  if (byPhone.data?.user_id) throw new Error("DUPLICATE_PHONE");

  const byUser = await admin.from("phone_identities").select("phone_e164").eq("user_id", userId).maybeSingle();
  if (byUser.error) throw new Error(byUser.error.message);
  if (byUser.data && byUser.data.phone_e164 !== phone) throw new Error("DUPLICATE_PHONE");
  throw new Error(inserted.error.message);
}

export async function createWhatsappAuthUser(
  admin: SupabaseClient,
  input: { email: string; phoneE164: string; fullName: string }
) {
  const payload = whatsappAuthUserPayload(input);
  const { data, error } = await admin.auth.admin.createUser(payload);
  if (error || !data.user) {
    if (error && isAuthEmailTaken(error)) throw new Error("EMAIL_TAKEN");
    throw new Error("CREATE_FAILED");
  }
  const profile = await admin
    .from("profiles")
    .update({
      full_name: input.fullName.trim(),
      whatsapp_number: input.phoneE164,
      email: payload.email,
    })
    .eq("id", data.user.id);
  if (profile.error) throw new Error(profile.error.message);
  return { userId: data.user.id, email: data.user.email ?? payload.email };
}
