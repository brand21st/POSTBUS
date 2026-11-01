import { describe, expect, it } from "vitest";
import {
  eventDownloadLeaseIdentity,
  resetEventDownloadLocks,
  withEventDownloadLock,
  withEventDownloadLeases,
} from "@/modules/india-post/event-download-lock";

describe("event download in-process lock", () => {
  it("shares one in-flight fetch for the same key", async () => {
    resetEventDownloadLocks();
    let runs = 0;
    const work = () =>
      withEventDownloadLock("cust:21102026", async () => {
        runs += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return runs;
      });
    const [a, b] = await Promise.all([work(), work()]);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(runs).toBe(1);
  });
});

describe("event download distributed lease", () => {
  it("scopes the lease by organization, customer id, event code, and date", () => {
    expect(
      eventDownloadLeaseIdentity({
        organizationId: "org-a",
        custId: "0000002954",
        eventDate: "21102026",
      })
    ).toEqual({
      organizationId: "org-a",
      custId: "0000002954",
      eventCode: "LE",
      eventDate: "21102026",
    });
  });

  it("lets only one worker hold the same org/customer/date lease", async () => {
    const held = new Map<string, string>();
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const key = `${args.p_organization_id}:${args.p_cust_id}:${args.p_event_date}`;
      if (name === "acquire_tracking_event_download_lock") {
        if (held.has(key)) return { data: null, error: null };
        const token = `t-${key}`;
        held.set(key, token);
        return { data: token, error: null };
      }
      if (name === "release_tracking_event_download_lock" && held.get(key) === args.p_token) {
        held.delete(key);
      }
      return { data: null, error: null };
    };
    const supabase = { rpc } as never;
    let inFlight = 0;
    let max = 0;
    await Promise.all([
      withEventDownloadLeases(
        supabase,
        { organizationId: "org-a", custId: "0000002954", eventDates: ["21102026"], waitMs: 80 },
        async (dates) => {
          inFlight += 1;
          max = Math.max(max, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 40));
          inFlight -= 1;
          return dates;
        }
      ),
      withEventDownloadLeases(
        supabase,
        { organizationId: "org-a", custId: "0000002954", eventDates: ["21102026"], waitMs: 80 },
        async (dates) => {
          inFlight += 1;
          max = Math.max(max, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 10));
          inFlight -= 1;
          return dates;
        }
      ),
    ]);
    expect(max).toBe(1);
    expect(held.size).toBe(0);
  });

  it("isolates tenants so two organizations can fetch the same date", async () => {
    const held = new Set<string>();
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const key = `${args.p_organization_id}:${args.p_event_date}`;
      if (name === "acquire_tracking_event_download_lock") {
        held.add(key);
        return { data: `t-${key}`, error: null };
      }
      held.delete(key);
      return { data: null, error: null };
    };
    let overlap = 0;
    let aRunning = false;
    await Promise.all([
      withEventDownloadLeases(
        { rpc } as never,
        { organizationId: "org-a", custId: "1", eventDates: ["21102026"] },
        async () => {
          aRunning = true;
          await new Promise((resolve) => setTimeout(resolve, 20));
          aRunning = false;
        }
      ),
      withEventDownloadLeases(
        { rpc } as never,
        { organizationId: "org-b", custId: "1", eventDates: ["21102026"] },
        async () => {
          if (aRunning) overlap += 1;
        }
      ),
    ]);
    expect(overlap).toBe(1);
  });

  it("steals an expired lease so a crash cannot deadlock", async () => {
    let expiresAt = 0;
    let token = "";
    const rpc = async (name: string) => {
      if (name === "acquire_tracking_event_download_lock") {
        if (expiresAt && Date.now() < expiresAt) return { data: null, error: null };
        token = `t-${Date.now()}`;
        expiresAt = Date.now() + 30;
        return { data: token, error: null };
      }
      return { data: null, error: null };
    };
    const supabase = { rpc } as never;
    await withEventDownloadLeases(
      supabase,
      { organizationId: "org-expire", custId: "1", eventDates: ["21102026"], waitMs: 20 },
      async () => {
        expiresAt = Date.now() - 1;
      }
    );
    const stolen = await withEventDownloadLeases(
      supabase,
      { organizationId: "org-expire", custId: "1", eventDates: ["21102026"], waitMs: 20 },
      async (dates) => dates
    );
    expect(stolen).toEqual(["21102026"]);
  });

  it("ignores a stale token release after ownership changes", async () => {
    let current = "token-a";
    const released: string[] = [];
    const rpc = async (name: string, args: Record<string, unknown>) => {
      if (name === "acquire_tracking_event_download_lock") {
        return { data: current, error: null };
      }
      if (name === "release_tracking_event_download_lock") {
        if (args.p_token === current) {
          released.push(String(args.p_token));
          current = "token-b";
        }
      }
      return { data: null, error: null };
    };
    await withEventDownloadLeases(
      { rpc } as never,
      { organizationId: "org-a", custId: "1", eventDates: ["21102026"] },
      async () => {
        current = "token-b";
      }
    );
    expect(released).toEqual([]);
  });
});
