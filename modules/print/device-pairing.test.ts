import { describe, expect, it } from "vitest";
import { MemoryDeviceRegistry, PAIRING_ATTEMPT_LIMIT, PAIRING_TTL_MS, createVerifier } from "@/modules/print/device-pairing";
import { isPrintDevicePublicPath } from "@/lib/api/v1/print-devices";
import { isPrintAgentApiPath } from "@/modules/print/service";
import { permissionForTenantRoute } from "@/lib/api/v1-permissions";

const device = {
  deviceName: "Packing Desk",
  platform: "windows",
  osVersion: "Windows 11",
  agentVersion: "0.2.0",
};

function pair(registry = new MemoryDeviceRegistry(), now = Date.now()) {
  const verifier = createVerifier();
  const started = registry.start({ ...device, verifier, now });
  if (!started.ok) throw new Error(started.message);
  const approved = registry.approve({
    code: started.value.code,
    userId: "user-1",
    organizationId: "org-a",
    organizationName: "Samanga",
    now,
  });
  if (!approved.ok) throw new Error(approved.message);
  return { registry, verifier, code: started.value.code, now };
}

describe("print device pairing", () => {
  it("pairs a device and keeps the raw code out of later reads", () => {
    const { registry, verifier, code } = pair();
    const polled = registry.poll({ verifier });
    expect(polled.ok && polled.value.status).toBe("approved");
    expect(JSON.stringify(polled)).not.toContain(code.replace("-", ""));
    const issued = registry.exchange({ verifier });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.value.organizationName).toBe("Samanga");
    expect(issued.value.accessToken.startsWith("pb_pdev_")).toBe(true);
    const beat = registry.heartbeat({ accessToken: issued.value.accessToken, printers: ["Zebra"] });
    expect(beat.ok && beat.value.connection).toBe("online");
    expect(registry.list("org-a")).toHaveLength(1);
  });

  it("rejects an invalid code without creating a device", () => {
    const registry = new MemoryDeviceRegistry();
    const result = registry.approve({
      code: "AAAA-BBBB",
      userId: "user-1",
      organizationId: "org-a",
      organizationName: "Samanga",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("That pairing code is not valid.");
    expect(registry.list("org-a")).toHaveLength(0);
  });

  it("expires a code before approval", () => {
    const registry = new MemoryDeviceRegistry();
    const verifier = createVerifier();
    const started = registry.start({ ...device, verifier, now: 0 });
    if (!started.ok) throw new Error("start");
    const approved = registry.approve({
      code: started.value.code,
      userId: "user-1",
      organizationId: "org-a",
      organizationName: "Samanga",
      now: PAIRING_TTL_MS + 1,
    });
    expect(approved.ok).toBe(false);
  });

  it("consumes a challenge only once", () => {
    const { registry, verifier } = pair();
    expect(registry.exchange({ verifier }).ok).toBe(true);
    const second = registry.exchange({ verifier });
    expect(second.ok).toBe(false);
  });

  it("does not let a different verifier redeem an approved code", () => {
    const { registry, code } = pair();
    const stranger = registry.exchange({ verifier: createVerifier() });
    expect(stranger.ok).toBe(false);
    const still = registry.approve({
      code,
      userId: "user-1",
      organizationId: "org-a",
      organizationName: "Samanga",
    });
    expect(still.ok).toBe(true);
  });

  it("keeps devices inside the approving organization", () => {
    const { registry, verifier } = pair();
    const issued = registry.exchange({ verifier });
    if (!issued.ok) throw new Error("exchange");
    registry.heartbeat({
      accessToken: issued.value.accessToken,
      organizationId: "org-b",
    });
    expect(registry.list("org-b")).toHaveLength(0);
    expect(registry.list("org-a")[0]?.deviceName).toBe("Packing Desk");
  });

  it("rejects a second organization approving the same code", () => {
    const { registry, code } = pair();
    const other = registry.approve({
      code,
      userId: "user-2",
      organizationId: "org-b",
      organizationName: "Other",
    });
    expect(other.ok).toBe(false);
    expect(registry.list("org-b")).toHaveLength(0);
  });

  it("locks further approvals after repeated invalid codes", () => {
    const registry = new MemoryDeviceRegistry();
    const verifier = createVerifier();
    const started = registry.start({ ...device, verifier, now: 5_000 });
    if (!started.ok) throw new Error("start");
    for (let attempt = 0; attempt < PAIRING_ATTEMPT_LIMIT; attempt += 1) {
      const failed = registry.approve({
        code: "ZZZZ-ZZZZ",
        userId: "user-1",
        organizationId: "org-a",
        organizationName: "Samanga",
        now: 5_000,
      });
      expect(failed.ok).toBe(false);
    }
    const locked = registry.approve({
      code: started.value.code,
      userId: "user-1",
      organizationId: "org-a",
      organizationName: "Samanga",
      now: 5_001,
    });
    expect(locked.ok).toBe(false);
    expect(registry.list("org-a")).toHaveLength(0);
  });

  it("revokes a device and rejects the old refresh token", () => {
    const { registry, verifier } = pair();
    const issued = registry.exchange({ verifier });
    if (!issued.ok) throw new Error("exchange");
    registry.revoke({ organizationId: "org-a", deviceId: issued.value.deviceId });
    expect(registry.heartbeat({ accessToken: issued.value.accessToken }).ok).toBe(false);
    const refreshed = registry.refresh({ refreshToken: issued.value.refreshToken });
    expect(refreshed.ok).toBe(false);
    if (refreshed.ok) return;
    expect(refreshed.error).toBe("revoked");
  });

  it("rotates refresh tokens and rejects the previous one", () => {
    const { registry, verifier } = pair();
    const issued = registry.exchange({ verifier });
    if (!issued.ok) throw new Error("exchange");
    const rotated = registry.refresh({ refreshToken: issued.value.refreshToken });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(registry.refresh({ refreshToken: issued.value.refreshToken }).ok).toBe(false);
    expect(registry.heartbeat({ accessToken: rotated.value.accessToken }).ok).toBe(true);
  });

  it("rejects an expired access token and an expired refresh token", () => {
    const { registry, verifier, now } = pair();
    const issued = registry.exchange({ verifier, now });
    if (!issued.ok) throw new Error("exchange");
    expect(registry.heartbeat({ accessToken: issued.value.accessToken, now: now + 16 * 60 * 1000 }).ok).toBe(false);
    expect(
      registry.refresh({ refreshToken: issued.value.refreshToken, now: now + 91 * 24 * 60 * 60 * 1000 }).ok
    ).toBe(false);
  });

  it("marks a device offline when the heartbeat is stale", () => {
    const { registry, verifier, now } = pair();
    const issued = registry.exchange({ verifier, now });
    if (!issued.ok) throw new Error("exchange");
    registry.heartbeat({ accessToken: issued.value.accessToken, now });
    expect(registry.list("org-a", now + 91_000)[0]?.connection).toBe("offline");
    expect(registry.list("org-a", now + 91_000)[0]?.authorization).toBe("active");
  });

  it("registers two devices without revoking the first", () => {
    const first = pair();
    const firstIssued = first.registry.exchange({ verifier: first.verifier });
    const secondVerifier = createVerifier();
    const started = first.registry.start({ ...device, deviceName: "Warehouse", verifier: secondVerifier });
    if (!started.ok || !firstIssued.ok) throw new Error("setup");
    first.registry.approve({
      code: started.value.code,
      userId: "user-1",
      organizationId: "org-a",
      organizationName: "Samanga",
    });
    expect(first.registry.exchange({ verifier: secondVerifier }).ok).toBe(true);
    expect(first.registry.heartbeat({ accessToken: firstIssued.value.accessToken }).ok).toBe(true);
    expect(first.registry.list("org-a")).toHaveLength(2);
  });

  it("leaves the legacy print agent routes unchanged", () => {
    expect(isPrintAgentApiPath("print-agent/heartbeat")).toBe(true);
    expect(isPrintAgentApiPath("print-agent/jobs/claim")).toBe(true);
    expect(isPrintAgentApiPath("print-devices/pair/start")).toBe(false);
    expect(isPrintDevicePublicPath("print-devices/jobs/claim")).toBe(true);
    expect(isPrintDevicePublicPath("print-devices/jobs/job-1/pdf")).toBe(true);
    expect(permissionForTenantRoute("POST", "print-devices/pair/approve", ["print-devices", "pair", "approve"])).toBe(
      "automation.manage"
    );
    expect(permissionForTenantRoute("GET", "print-devices", ["print-devices"])).toBeUndefined();
    expect(permissionForTenantRoute("POST", "print-station/token", ["print-station", "token"])).toBe("automation.manage");
  });
});
