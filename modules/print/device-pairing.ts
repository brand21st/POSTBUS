import { createHash, randomBytes, randomInt } from "crypto";

export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const PAIRING_ATTEMPT_LIMIT = 5;
export const ACCESS_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const DEVICE_ONLINE_MS = 90 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type PairingFailure = "invalid" | "unauthorized" | "revoked";

export type PairingResult<T> = { ok: true; value: T } | { ok: false; error: PairingFailure; message: string };

export type DeviceConnection = "online" | "offline";
export type DeviceAuthorization = "active" | "revoked";

export type ListedDevice = {
  id: string;
  deviceName: string;
  platform: string;
  osVersion: string;
  agentVersion: string;
  lastSeenAt: string | null;
  connection: DeviceConnection;
  authorization: DeviceAuthorization;
};

type ChallengeStatus = "pending" | "approved" | "consumed" | "expired" | "locked";

type Challenge = {
  id: string;
  codeHash: string;
  verifierHash: string;
  deviceName: string;
  platform: string;
  osVersion: string;
  agentVersion: string;
  status: ChallengeStatus;
  expiresAt: number;
  attemptCount: number;
  approvedBy: string | null;
  approvedOrganizationId: string | null;
  approvedOrganizationName: string | null;
  approvedAt: number | null;
  consumedAt: number | null;
};

type Device = {
  id: string;
  organizationId: string;
  organizationName: string;
  deviceName: string;
  platform: string;
  osVersion: string;
  agentVersion: string;
  authorization: DeviceAuthorization;
  lastSeenAt: number | null;
  revokedAt: number | null;
  printers: unknown[];
};

type Session = {
  deviceId: string;
  accessHash: string;
  refreshHash: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
};

export type StartInput = {
  verifier: string;
  deviceName: string;
  platform: string;
  osVersion: string;
  agentVersion: string;
  now?: number;
};

export function hashPairingSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizePairingCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatPairingCode(raw: string) {
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

export function createVerifier() {
  return randomBytes(32).toString("base64url");
}

function failure(error: PairingFailure): PairingResult<never> {
  if (error === "revoked") {
    return { ok: false, error, message: "This computer has been disconnected from your PostBus organization." };
  }
  if (error === "unauthorized") {
    return { ok: false, error, message: "This computer is not connected to PostBus." };
  }
  return { ok: false, error, message: "That pairing code is not valid." };
}

function deviceToken(prefix: string) {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function connectionFor(device: Device, now: number): DeviceConnection {
  if (device.authorization !== "active" || device.lastSeenAt == null) return "offline";
  return now - device.lastSeenAt <= DEVICE_ONLINE_MS ? "online" : "offline";
}

function listed(device: Device, now: number): ListedDevice {
  return {
    id: device.id,
    deviceName: device.deviceName,
    platform: device.platform,
    osVersion: device.osVersion,
    agentVersion: device.agentVersion,
    lastSeenAt: device.lastSeenAt ? new Date(device.lastSeenAt).toISOString() : null,
    connection: connectionFor(device, now),
    authorization: device.authorization,
  };
}

export class MemoryDeviceRegistry {
  private challenges: Challenge[] = [];
  private devices: Device[] = [];
  private sessions: Session[] = [];
  private events: Array<{ type: string; organizationId: string | null; deviceId: string | null }> = [];
  private approvalFailures = new Map<string, { count: number; resetAt: number }>();

  start(input: StartInput) {
    const now = input.now ?? Date.now();
    const verifier = input.verifier.trim();
    const deviceName = input.deviceName.trim().slice(0, 80);
    if (verifier.length < 32 || !deviceName) return failure("invalid");
    const verifierHash = hashPairingSecret(verifier);
    if (this.challenges.some((row) => row.verifierHash === verifierHash && row.status !== "consumed")) {
      return failure("invalid");
    }
    let code = "";
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let raw = "";
      for (let index = 0; index < 8; index += 1) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      const codeHash = hashPairingSecret(raw);
      const open = this.challenges.some(
        (row) => row.codeHash === codeHash && (row.status === "pending" || row.status === "approved") && row.expiresAt > now
      );
      if (!open) {
        code = raw;
        break;
      }
    }
    if (!code) return failure("invalid");
    const challenge: Challenge = {
      id: randomBytes(16).toString("hex"),
      codeHash: hashPairingSecret(code),
      verifierHash,
      deviceName,
      platform: input.platform.trim() || "windows",
      osVersion: input.osVersion.trim(),
      agentVersion: input.agentVersion.trim(),
      status: "pending",
      expiresAt: now + PAIRING_TTL_MS,
      attemptCount: 0,
      approvedBy: null,
      approvedOrganizationId: null,
      approvedOrganizationName: null,
      approvedAt: null,
      consumedAt: null,
    };
    this.challenges.push(challenge);
    this.events.push({ type: "pairing_started", organizationId: null, deviceId: null });
    return {
      ok: true as const,
      value: {
        code: formatPairingCode(code),
        expiresAt: new Date(challenge.expiresAt).toISOString(),
        deviceName,
      },
    };
  }

  approve(input: { code: string; userId: string; organizationId: string; organizationName: string; now?: number }) {
    const now = input.now ?? Date.now();
    const failures = this.approvalFailures.get(input.userId);
    if (failures && failures.resetAt > now && failures.count >= PAIRING_ATTEMPT_LIMIT) return failure("invalid");
    const codeHash = hashPairingSecret(normalizePairingCode(input.code));
    const challenge = this.challenges.find((row) => row.codeHash === codeHash);
    if (!challenge) {
      this.noteApprovalFailure(input.userId, now);
      return failure("invalid");
    }
    this.expire(challenge, now);
    if (challenge.status === "approved" && challenge.approvedOrganizationId === input.organizationId) {
      return { ok: true as const, value: this.preview(challenge) };
    }
    if (challenge.status !== "pending") {
      challenge.attemptCount += 1;
      this.noteApprovalFailure(input.userId, now);
      return failure("invalid");
    }
    if (challenge.attemptCount >= PAIRING_ATTEMPT_LIMIT) {
      challenge.status = "locked";
      return failure("invalid");
    }
    challenge.status = "approved";
    challenge.approvedBy = input.userId;
    challenge.approvedOrganizationId = input.organizationId;
    challenge.approvedOrganizationName = input.organizationName;
    challenge.approvedAt = now;
    this.approvalFailures.delete(input.userId);
    this.events.push({ type: "pairing_approved", organizationId: input.organizationId, deviceId: null });
    return { ok: true as const, value: this.preview(challenge) };
  }

  poll(input: { verifier: string; now?: number }) {
    const now = input.now ?? Date.now();
    const challenge = this.byVerifier(input.verifier);
    if (!challenge) return failure("unauthorized");
    this.expire(challenge, now);
    return {
      ok: true as const,
      value: {
        status: challenge.status,
        expiresAt: new Date(challenge.expiresAt).toISOString(),
        organizationName: challenge.status === "approved" ? challenge.approvedOrganizationName : null,
        deviceName: challenge.deviceName,
      },
    };
  }

  exchange(input: { verifier: string; now?: number }) {
    const now = input.now ?? Date.now();
    const challenge = this.byVerifier(input.verifier);
    if (!challenge) return failure("unauthorized");
    this.expire(challenge, now);
    if (challenge.status !== "approved" || !challenge.approvedOrganizationId || !challenge.approvedOrganizationName) {
      return failure("invalid");
    }
    challenge.status = "consumed";
    challenge.consumedAt = now;
    const device: Device = {
      id: randomBytes(16).toString("hex"),
      organizationId: challenge.approvedOrganizationId,
      organizationName: challenge.approvedOrganizationName,
      deviceName: challenge.deviceName,
      platform: challenge.platform,
      osVersion: challenge.osVersion,
      agentVersion: challenge.agentVersion,
      authorization: "active",
      lastSeenAt: null,
      revokedAt: null,
      printers: [],
    };
    const issued = this.issueSession(device.id, now);
    this.devices.push(device);
    this.events.push({ type: "pairing_consumed", organizationId: device.organizationId, deviceId: device.id });
    return {
      ok: true as const,
      value: {
        deviceId: device.id,
        organizationId: device.organizationId,
        organizationName: device.organizationName,
        deviceName: device.deviceName,
        ...issued,
      },
    };
  }

  heartbeat(input: { accessToken: string; agentVersion?: string; printers?: unknown[]; organizationId?: string; now?: number }) {
    const now = input.now ?? Date.now();
    const session = this.sessionByAccess(input.accessToken);
    if (!session) return failure("unauthorized");
    if (session.accessExpiresAt <= now) return failure("unauthorized");
    const device = this.devices.find((row) => row.id === session.deviceId);
    if (!device) return failure("unauthorized");
    if (device.authorization === "revoked") return failure("revoked");
    device.lastSeenAt = now;
    if (input.agentVersion?.trim()) device.agentVersion = input.agentVersion.trim();
    if (Array.isArray(input.printers)) device.printers = input.printers;
    return {
      ok: true as const,
      value: {
        deviceId: device.id,
        organizationName: device.organizationName,
        deviceName: device.deviceName,
        authorization: device.authorization,
        connection: "online" as const,
      },
    };
  }

  refresh(input: { refreshToken: string; now?: number }) {
    const now = input.now ?? Date.now();
    const hash = hashPairingSecret(input.refreshToken.trim());
    const session = this.sessions.find((row) => row.refreshHash === hash);
    if (!session) return failure("unauthorized");
    const device = this.devices.find((row) => row.id === session.deviceId);
    if (!device) return failure("unauthorized");
    if (device.authorization === "revoked") return failure("revoked");
    if (session.refreshExpiresAt <= now) return failure("unauthorized");
    const issued = this.issueSession(device.id, now);
    session.refreshHash = "rotated";
    session.accessHash = "rotated";
    this.events.push({ type: "credential_refreshed", organizationId: device.organizationId, deviceId: device.id });
    return {
      ok: true as const,
      value: {
        deviceId: device.id,
        organizationId: device.organizationId,
        organizationName: device.organizationName,
        deviceName: device.deviceName,
        ...issued,
      },
    };
  }

  disconnect(accessToken: string, now = Date.now()) {
    const session = this.sessionByAccess(accessToken);
    if (!session) return failure("unauthorized");
    const device = this.devices.find((row) => row.id === session.deviceId);
    if (!device) return failure("unauthorized");
    return this.revoke({ organizationId: device.organizationId, deviceId: device.id, now });
  }

  revoke(input: { organizationId: string; deviceId: string; now?: number }) {
    const now = input.now ?? Date.now();
    const device = this.devices.find((row) => row.id === input.deviceId && row.organizationId === input.organizationId);
    if (!device) return failure("invalid");
    device.authorization = "revoked";
    device.revokedAt = now;
    this.events.push({ type: "device_revoked", organizationId: device.organizationId, deviceId: device.id });
    return { ok: true as const, value: listed(device, now) };
  }

  list(organizationId: string, now = Date.now()) {
    return this.devices.filter((device) => device.organizationId === organizationId).map((device) => listed(device, now));
  }

  eventTypes() {
    return this.events.map((event) => event.type);
  }

  private noteApprovalFailure(userId: string, now: number) {
    const current = this.approvalFailures.get(userId);
    if (!current || current.resetAt <= now) {
      this.approvalFailures.set(userId, { count: 1, resetAt: now + PAIRING_TTL_MS });
      return;
    }
    current.count += 1;
  }

  private preview(challenge: Challenge) {
    return {
      deviceName: challenge.deviceName,
      platform: challenge.platform,
      osVersion: challenge.osVersion,
      agentVersion: challenge.agentVersion,
      organizationName: challenge.approvedOrganizationName,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
    };
  }

  private byVerifier(verifier: string) {
    const hash = hashPairingSecret(verifier.trim());
    return this.challenges.find((row) => row.verifierHash === hash);
  }

  private expire(challenge: Challenge, now: number) {
    if ((challenge.status === "pending" || challenge.status === "approved") && challenge.expiresAt <= now) {
      challenge.status = "expired";
    }
  }

  private sessionByAccess(token: string) {
    const hash = hashPairingSecret(token.trim());
    return this.sessions.find((row) => row.accessHash === hash);
  }

  private issueSession(deviceId: string, now: number) {
    const accessToken = deviceToken("pb_pdev_");
    const refreshToken = deviceToken("pb_pref_");
    const accessExpiresAt = now + ACCESS_TTL_MS;
    const refreshExpiresAt = now + REFRESH_TTL_MS;
    this.sessions.push({
      deviceId,
      accessHash: hashPairingSecret(accessToken),
      refreshHash: hashPairingSecret(refreshToken),
      accessExpiresAt,
      refreshExpiresAt,
    });
    return {
      accessToken,
      refreshToken,
      accessExpiresAt: new Date(accessExpiresAt).toISOString(),
      refreshExpiresAt: new Date(refreshExpiresAt).toISOString(),
    };
  }
}
