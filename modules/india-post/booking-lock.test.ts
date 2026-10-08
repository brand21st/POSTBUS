import { describe, expect, it } from "vitest";
import {
  bookingLockBusyError,
  withIndiaPostBookingLock,
  withProcessBookingLock,
} from "@/modules/india-post/booking-lock";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("withProcessBookingLock", () => {
  it("TEST 1 serializes 30 tasks on the same connection", async () => {
    let inFlight = 0;
    let max = 0;
    await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        withProcessBookingLock("org-lock-30", async () => {
          inFlight += 1;
          max = Math.max(max, inFlight);
          await sleep(2);
          inFlight -= 1;
          return index;
        })
      )
    );
    expect(max).toBe(1);
  });

  it("TEST 8 lets two connections run independently", async () => {
    let overlap = 0;
    let aRunning = false;
    await Promise.all([
      withProcessBookingLock("org-a-lock", async () => {
        aRunning = true;
        await sleep(25);
        aRunning = false;
      }),
      withProcessBookingLock("org-b-lock", async () => {
        await sleep(5);
        if (aRunning) overlap += 1;
      }),
    ]);
    expect(overlap).toBe(1);
  });
});

describe("withIndiaPostBookingLock", () => {
  it("TEST 9 two workers: only one holds the DB lease", async () => {
    let held: string | null = null;
    const rpc = async (name: string, args: { p_organization_id?: string; p_token?: string }) => {
      if (name === "acquire_india_post_booking_lock") {
        if (held) return { data: null, error: null };
        held = "token-1";
        return { data: held, error: null };
      }
      if (name === "release_india_post_booking_lock" && args.p_token === held) {
        held = null;
      }
      return { data: null, error: null };
    };
    const supabase = { rpc } as never;
    let inFlight = 0;
    let max = 0;
    await Promise.all([
      withIndiaPostBookingLock(supabase, { organizationId: "org-db", skipProcessLock: true }, async () => {
        inFlight += 1;
        max = Math.max(max, inFlight);
        await sleep(40);
        inFlight -= 1;
      }),
      withIndiaPostBookingLock(supabase, { organizationId: "org-db", skipProcessLock: true }, async () => {
        inFlight += 1;
        max = Math.max(max, inFlight);
        await sleep(10);
        inFlight -= 1;
      }),
    ]);
    expect(max).toBe(1);
    expect(held).toBeNull();
  });

  it("TEST 10 expired leases are stealable so a crash cannot deadlock", async () => {
    let expiresAt = 0;
    let token = "";
    const rpc = async (name: string) => {
      if (name === "acquire_india_post_booking_lock") {
        if (expiresAt && Date.now() < expiresAt) return { data: null, error: null };
        token = `t-${Date.now()}`;
        expiresAt = Date.now() + 20;
        return { data: token, error: null };
      }
      return { data: null, error: null };
    };
    const supabase = { rpc } as never;
    await withIndiaPostBookingLock(supabase, { organizationId: "org-expire", skipProcessLock: true }, async () => {
      expiresAt = Date.now() - 1;
    });
    const stolen = await withIndiaPostBookingLock(
      supabase,
      { organizationId: "org-expire", skipProcessLock: true },
      async () => "ok"
    );
    expect(stolen).toBe("ok");
  });

  it("throws a retryable lock-busy error after wait timeout", async () => {
    const rpc = async () => ({ data: null, error: null });
    await expect(
      withIndiaPostBookingLock(
        { rpc } as never,
        { organizationId: "org-timeout", skipProcessLock: true, waitMs: 20 },
        async () => "nope"
      )
    ).rejects.toMatchObject({ code: "TEMPORARY_PROVIDER_FAILURE" });
    expect(bookingLockBusyError().code).toBe("TEMPORARY_PROVIDER_FAILURE");
  });

  it("fails closed when the DB lock RPC is missing and never runs work", async () => {
    let ran = 0;
    await expect(
      withIndiaPostBookingLock({} as never, { organizationId: "org-missing", skipProcessLock: true }, async () => {
        ran += 1;
        return "posted";
      })
    ).rejects.toMatchObject({ code: "TEMPORARY_PROVIDER_FAILURE" });
    expect(ran).toBe(0);

    await expect(
      withIndiaPostBookingLock(
        {
          rpc: async () => ({ data: null, error: { code: "42883", message: "function does not exist" } }),
        } as never,
        { organizationId: "org-missing-fn", skipProcessLock: true },
        async () => {
          ran += 1;
          return "posted";
        }
      )
    ).rejects.toMatchObject({
      message: expect.stringContaining("was not called"),
    });
    expect(ran).toBe(0);
  });

  it("fails closed on malformed or timed-out lock RPC", async () => {
    let ran = 0;
    await expect(
      withIndiaPostBookingLock(
        { rpc: async () => ({ data: { unexpected: true }, error: null }) } as never,
        { organizationId: "org-malformed", skipProcessLock: true },
        async () => {
          ran += 1;
          return "posted";
        }
      )
    ).rejects.toMatchObject({ code: "TEMPORARY_PROVIDER_FAILURE" });
    expect(ran).toBe(0);
  });
});
