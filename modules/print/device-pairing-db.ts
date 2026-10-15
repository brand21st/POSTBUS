import { randomBytes, randomInt } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import {
  ACCESS_TTL_MS,
  DEVICE_ONLINE_MS,
  PAIRING_ATTEMPT_LIMIT,
  PAIRING_TTL_MS,
  REFRESH_TTL_MS,
  formatPairingCode,
  hashPairingSecret,
  normalizePairingCode,
  type ListedDevice,
} from "@/modules/print/device-pairing";

const INVALID = "That pairing code is not valid.";
const UNAUTHORIZED = "This computer is not connected to PostBus.";
const REVOKED = "This computer has been disconnected from your PostBus organization.";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type ChallengeRow = {
  id: string;
  device_name: string;
  platform: string;
  os_version: string;
  agent_version: string;
  status: string;
  expires_at: string;
  attempt_count: number;
  approved_organization_id: string | null;
  approved_organization_name: string | null;
};

function unavailable(error: { code?: string; message?: string } | null): never {
  if (error?.code === "42P01" || error?.code === "PGRST205") {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Device pairing is not enabled on this server.");
  }
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, INVALID);
}

function token(prefix: string) {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

async function event(
  supabase: SupabaseClient,
  input: { organizationId?: string | null; deviceId?: string | null; challengeId?: string | null; type: string }
) {
  await supabase.from("print_device_events").insert({
    organization_id: input.organizationId ?? null,
    device_id: input.deviceId ?? null,
    challenge_id: input.challengeId ?? null,
    event_type: input.type,
    event_metadata: {},
  });
}

export async function startDevicePairing(
  supabase: SupabaseClient,
  input: { verifier: string; deviceName: string; platform: string; osVersion: string; agentVersion: string }
) {
  const verifier = input.verifier.trim();
  const deviceName = input.deviceName.trim().slice(0, 80);
  if (verifier.length < 32 || !deviceName) throw new AppError(ERROR_CODES.VALIDATION_ERROR, INVALID);
  let code = "";
  for (let attempt = 0; attempt < 8 && !code; attempt += 1) {
    let raw = "";
    for (let index = 0; index < 8; index += 1) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    const { error } = await supabase.from("print_pairing_challenges").insert({
      code_hash: hashPairingSecret(raw),
      verifier_hash: hashPairingSecret(verifier),
      device_name: deviceName,
      platform: input.platform.trim() || "windows",
      os_version: input.osVersion.trim(),
      agent_version: input.agentVersion.trim(),
      expires_at: new Date(Date.now() + PAIRING_TTL_MS).toISOString(),
    });
    if (!error) code = raw;
    else if (error.code === "23505") continue;
    else unavailable(error);
  }
  if (!code) throw new AppError(ERROR_CODES.VALIDATION_ERROR, INVALID);
  await event(supabase, { type: "pairing_started" });
  return { code: formatPairingCode(code), expiresAt: new Date(Date.now() + PAIRING_TTL_MS).toISOString(), deviceName };
}

export async function approveDevicePairing(
  supabase: SupabaseClient,
  input: { code: string; userId: string; organizationId: string; organizationName: string }
) {
  const since = new Date(Date.now() - PAIRING_TTL_MS).toISOString();
  const { count } = await supabase
    .from("print_device_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "pairing_rejected")
    .eq("organization_id", input.organizationId)
    .gte("created_at", since);
  if ((count ?? 0) >= PAIRING_ATTEMPT_LIMIT) throw new AppError(ERROR_CODES.VALIDATION_ERROR, INVALID);

  const codeHash = hashPairingSecret(normalizePairingCode(input.code));
  const { data, error } = await supabase
    .from("print_pairing_challenges")
    .select("id, device_name, platform, os_version, agent_version, status, expires_at, attempt_count, approved_organization_id, approved_organization_name")
    .eq("code_hash", codeHash)
    .maybeSingle();
  if (error) unavailable(error);
  const challenge = data as ChallengeRow | null;
  if (!challenge) {
    await event(supabase, { type: "pairing_rejected", organizationId: input.organizationId });
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, INVALID);
  }
  if (challenge.status === "approved" && challenge.approved_organization_id === input.organizationId) {
    return preview(challenge);
  }
  const expired = new Date(challenge.expires_at).getTime() <= Date.now();
  if (challenge.status !== "pending" || expired || challenge.attempt_count >= PAIRING_ATTEMPT_LIMIT) {
    await event(supabase, { type: "pairing_rejected", organizationId: input.organizationId, challengeId: challenge.id });
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, INVALID);
  }
  const { data: updated, error: updateError } = await supabase
    .from("print_pairing_challenges")
    .update({
      status: "approved",
      approved_by: input.userId,
      approved_organization_id: input.organizationId,
      approved_organization_name: input.organizationName,
      approved_at: new Date().toISOString(),
    })
    .eq("id", challenge.id)
    .eq("status", "pending")
    .select("id, device_name, platform, os_version, agent_version, status, expires_at, attempt_count, approved_organization_id, approved_organization_name")
    .maybeSingle();
  if (updateError) unavailable(updateError);
  if (!updated) throw new AppError(ERROR_CODES.VALIDATION_ERROR, INVALID);
  await event(supabase, { type: "pairing_approved", organizationId: input.organizationId, challengeId: challenge.id });
  await supabase.from("audit_logs").insert({
    organization_id: input.organizationId,
    actor_id: input.userId,
    action: "print_device.pairing_approved",
    entity_type: "print_pairing_challenge",
    entity_id: challenge.id,
  });
  return preview(updated as ChallengeRow);
}

export async function pollDevicePairing(supabase: SupabaseClient, verifier: string) {
  const challenge = await challengeByVerifier(supabase, verifier);
  if (!challenge) throw new AppError(ERROR_CODES.AUTH_REQUIRED, UNAUTHORIZED);
  return {
    status: expired(challenge) ? "expired" : challenge.status,
    expiresAt: challenge.expires_at,
    organizationName: challenge.status === "approved" ? challenge.approved_organization_name : null,
    deviceName: challenge.device_name,
  };
}

export async function exchangeDevicePairing(supabase: SupabaseClient, verifier: string) {
  const hash = hashPairingSecret(verifier.trim());
  const { data, error } = await supabase
    .from("print_pairing_challenges")
    .update({ status: "consumed", consumed_at: new Date().toISOString() })
    .eq("verifier_hash", hash)
    .eq("status", "approved")
    .gt("expires_at", new Date().toISOString())
    .select("id, device_name, platform, os_version, agent_version, approved_organization_id, approved_organization_name")
    .maybeSingle();
  if (error) unavailable(error);
  const challenge = data as {
    id: string;
    device_name: string;
    platform: string;
    os_version: string;
    agent_version: string;
    approved_organization_id: string | null;
    approved_organization_name: string | null;
  } | null;
  if (!challenge?.approved_organization_id || !challenge.approved_organization_name) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, INVALID);
  }
  const { data: device, error: deviceError } = await supabase
    .from("print_devices")
    .insert({
      organization_id: challenge.approved_organization_id,
      device_name: challenge.device_name,
      platform: challenge.platform,
      os_version: challenge.os_version,
      agent_version: challenge.agent_version,
    })
    .select("id")
    .single();
  if (deviceError || !device) unavailable(deviceError);
  const issued = await issueSession(supabase, device.id as string);
  await event(supabase, {
    type: "pairing_consumed",
    organizationId: challenge.approved_organization_id,
    deviceId: device.id as string,
    challengeId: challenge.id,
  });
  return {
    deviceId: device.id as string,
    organizationId: challenge.approved_organization_id,
    organizationName: challenge.approved_organization_name,
    deviceName: challenge.device_name,
    ...issued,
  };
}

export async function heartbeatPrintDevice(
  supabase: SupabaseClient,
  input: { accessToken: string; agentVersion?: string; printers?: unknown[] }
) {
  const device = await deviceForAccess(supabase, input.accessToken);
  const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  if (input.agentVersion?.trim()) patch.agent_version = input.agentVersion.trim();
  if (Array.isArray(input.printers)) patch.last_printers = input.printers;
  await supabase.from("print_devices").update(patch).eq("id", device.id).eq("status", "active");
  return {
    deviceId: device.id,
    organizationName: device.organization_name,
    deviceName: device.device_name,
    authorization: "active" as const,
    connection: "online" as const,
  };
}

export async function refreshPrintDevice(supabase: SupabaseClient, refreshToken: string) {
  const hash = hashPairingSecret(refreshToken.trim());
  const consumed = `rotated-${randomBytes(16).toString("hex")}`;
  const { data, error } = await supabase
    .from("print_device_sessions")
    .update({ refresh_token_hash: consumed, rotated_at: new Date().toISOString() })
    .eq("refresh_token_hash", hash)
    .select("id, device_id, refresh_expires_at")
    .maybeSingle();
  if (error) unavailable(error);
  if (!data) throw new AppError(ERROR_CODES.AUTH_REQUIRED, UNAUTHORIZED);
  const session = data as { id: string; device_id: string };
  const { data: device, error: deviceError } = await supabase
    .from("print_devices")
    .select("id, organization_id, device_name, status, organizations(name)")
    .eq("id", session.device_id)
    .maybeSingle();
  if (deviceError) unavailable(deviceError);
  const row = device as { id: string; organization_id: string; device_name: string; status: string; organizations: { name: string } | { name: string }[] | null } | null;
  if (!row) throw new AppError(ERROR_CODES.AUTH_REQUIRED, UNAUTHORIZED);
  if (row.status === "revoked") throw new AppError(ERROR_CODES.AUTH_REQUIRED, REVOKED);
  if (new Date((data as { refresh_expires_at: string }).refresh_expires_at).getTime() <= Date.now()) {
    throw new AppError(ERROR_CODES.AUTH_REQUIRED, UNAUTHORIZED);
  }
  const issued = await issueSession(supabase, row.id);
  await supabase
    .from("print_device_sessions")
    .update({ access_token_hash: consumed, access_expires_at: new Date(0).toISOString() })
    .eq("id", session.id);
  const organization = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
  await event(supabase, { type: "credential_refreshed", organizationId: row.organization_id, deviceId: row.id });
  return {
    deviceId: row.id,
    organizationId: row.organization_id,
    organizationName: organization?.name ?? "",
    deviceName: row.device_name,
    ...issued,
  };
}

export async function listPrintDevices(supabase: SupabaseClient, organizationId: string): Promise<ListedDevice[]> {
  const { data, error } = await supabase
    .from("print_devices")
    .select("id, device_name, platform, os_version, agent_version, last_seen_at, status")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) unavailable(error);
  const now = Date.now();
  return ((data ?? []) as Array<{
    id: string;
    device_name: string;
    platform: string;
    os_version: string;
    agent_version: string;
    last_seen_at: string | null;
    status: "active" | "revoked";
  }>).map((device) => ({
    id: device.id,
    deviceName: device.device_name,
    platform: device.platform,
    osVersion: device.os_version,
    agentVersion: device.agent_version,
    lastSeenAt: device.last_seen_at,
    authorization: device.status,
    connection:
      device.status === "active" && device.last_seen_at && now - new Date(device.last_seen_at).getTime() <= DEVICE_ONLINE_MS
        ? "online"
        : "offline",
  }));
}

export async function disconnectCurrentDevice(supabase: SupabaseClient, accessToken: string) {
  const device = await deviceForAccess(supabase, accessToken);
  const { error } = await supabase
    .from("print_devices")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", device.id)
    .eq("status", "active");
  if (error) unavailable(error);
  await supabase.from("print_device_sessions").delete().eq("device_id", device.id);
  await event(supabase, { type: "device_revoked", deviceId: device.id });
  return { authorization: "revoked" as const };
}

export async function revokePrintDevice(supabase: SupabaseClient, input: { organizationId: string; deviceId: string; userId: string }) {
  const { data, error } = await supabase
    .from("print_devices")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", input.deviceId)
    .eq("organization_id", input.organizationId)
    .eq("status", "active")
    .select("id, device_name")
    .maybeSingle();
  if (error) unavailable(error);
  if (!data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, INVALID);
  await event(supabase, { type: "device_revoked", organizationId: input.organizationId, deviceId: input.deviceId });
  await supabase.from("audit_logs").insert({
    organization_id: input.organizationId,
    actor_id: input.userId,
    action: "print_device.revoked",
    entity_type: "print_device",
    entity_id: input.deviceId,
  });
  return { id: (data as { id: string }).id, deviceName: (data as { device_name: string }).device_name, authorization: "revoked" as const };
}

async function challengeByVerifier(supabase: SupabaseClient, verifier: string) {
  const { data, error } = await supabase
    .from("print_pairing_challenges")
    .select("id, device_name, platform, os_version, agent_version, status, expires_at, attempt_count, approved_organization_id, approved_organization_name")
    .eq("verifier_hash", hashPairingSecret(verifier.trim()))
    .maybeSingle();
  if (error) unavailable(error);
  return data as ChallengeRow | null;
}

function expired(challenge: ChallengeRow) {
  return (challenge.status === "pending" || challenge.status === "approved") && new Date(challenge.expires_at).getTime() <= Date.now();
}

function preview(challenge: ChallengeRow) {
  return {
    deviceName: challenge.device_name,
    platform: challenge.platform,
    osVersion: challenge.os_version,
    agentVersion: challenge.agent_version,
    organizationName: challenge.approved_organization_name,
    expiresAt: challenge.expires_at,
  };
}

async function deviceForAccess(supabase: SupabaseClient, accessToken: string) {
  const hash = hashPairingSecret(accessToken.trim());
  const { data, error } = await supabase
    .from("print_device_sessions")
    .select("device_id, access_expires_at")
    .eq("access_token_hash", hash)
    .maybeSingle();
  if (error) unavailable(error);
  const session = data as { device_id: string; access_expires_at: string } | null;
  if (!session) throw new AppError(ERROR_CODES.AUTH_REQUIRED, UNAUTHORIZED);
  const { data: device, error: deviceError } = await supabase
    .from("print_devices")
    .select("id, device_name, status, organizations(name)")
    .eq("id", session.device_id)
    .maybeSingle();
  if (deviceError) unavailable(deviceError);
  const row = device as { id: string; device_name: string; status: string; organizations: { name: string } | { name: string }[] | null } | null;
  if (!row) throw new AppError(ERROR_CODES.AUTH_REQUIRED, UNAUTHORIZED);
  if (row.status === "revoked") throw new AppError(ERROR_CODES.AUTH_REQUIRED, REVOKED);
  if (new Date(session.access_expires_at).getTime() <= Date.now()) {
    throw new AppError(ERROR_CODES.AUTH_REQUIRED, UNAUTHORIZED);
  }
  const organization = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
  return { id: row.id, device_name: row.device_name, organization_name: organization?.name ?? "" };
}

async function issueSession(supabase: SupabaseClient, deviceId: string) {
  const accessToken = token("pb_pdev_");
  const refreshToken = token("pb_pref_");
  const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_MS).toISOString();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS).toISOString();
  const { error } = await supabase.from("print_device_sessions").insert({
    device_id: deviceId,
    access_token_hash: hashPairingSecret(accessToken),
    refresh_token_hash: hashPairingSecret(refreshToken),
    access_expires_at: accessExpiresAt,
    refresh_expires_at: refreshExpiresAt,
  });
  if (error) unavailable(error);
  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
}
