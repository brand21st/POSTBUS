import { describe, expect, it } from "vitest";
import { withProcessSessionLock } from "@/modules/india-post/session";
import { sessionLockUnavailableError, withIndiaPostSessionLock } from "@/modules/india-post/session-lock";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("withProcessSessionLock", () => {
  it("serializes work on one connection and lets two connections overlap", async () => {
    let inFlight = 0;
    let max = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        withProcessSessionLock("conn-lock", async () => {
          inFlight += 1;
          max = Math.max(max, inFlight);
          await sleep(2);
          inFlight -= 1;
        })
      )
    );
    expect(max).toBe(1);

    let overlap = 0;
    let aRunning = false;
    await Promise.all([
      withProcessSessionLock("conn-a", async () => {
        aRunning = true;
        await sleep(20);
        aRunning = false;
      }),
      withProcessSessionLock("conn-b", async () => {
        await sleep(5);
        if (aRunning) overlap += 1;
      }),
    ]);
    expect(overlap).toBe(1);
  });
});

describe("withIndiaPostSessionLock", () => {
  it("fails closed when the RPC is missing", async () => {
    await expect(
      withIndiaPostSessionLock({} as never, { connectionId: "conn-missing", waitMs: 50 }, async () => "ok")
    ).rejects.toMatchObject({ code: "TEMPORARY_PROVIDER_FAILURE" });
    expect(sessionLockUnavailableError().code).toBe("TEMPORARY_PROVIDER_FAILURE");
  });

  it("serializes two workers on the same connection id", async () => {
    let held: string | null = null;
    const rpc = async (name: string, args: { p_connection_id?: string; p_token?: string }) => {
      if (name === "acquire_india_post_session_lock") {
        if (held) return { data: null, error: null };
        held = "session-token-1";
        return { data: held, error: null };
      }
      if (name === "release_india_post_session_lock" && args.p_token === held) {
        held = null;
      }
      return { data: null, error: null };
    };
    const supabase = { rpc } as never;
    let inFlight = 0;
    let max = 0;
    await Promise.all([
      withIndiaPostSessionLock(supabase, { connectionId: "conn-db", organizationId: "org-db" }, async () => {
        inFlight += 1;
        max = Math.max(max, inFlight);
        await sleep(30);
        inFlight -= 1;
      }),
      withIndiaPostSessionLock(supabase, { connectionId: "conn-db", organizationId: "org-db" }, async () => {
        inFlight += 1;
        max = Math.max(max, inFlight);
        await sleep(10);
        inFlight -= 1;
      }),
    ]);
    expect(max).toBe(1);
    expect(held).toBeNull();
  });

  it("passes the fencing token into locked work", async () => {
    const rpc = async (name: string) => {
      if (name === "acquire_india_post_session_lock") return { data: "fence-token-1", error: null };
      return { data: null, error: null };
    };
    let seen = "";
    await withIndiaPostSessionLock({ rpc } as never, { connectionId: "conn-fence" }, async (lockToken) => {
      seen = lockToken;
    });
    expect(seen).toBe("fence-token-1");
  });
});
