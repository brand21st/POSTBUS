import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import {
  claimManualPrintKey,
  printRequestFingerprint,
  requirePrintIdempotencyKey,
} from "@/modules/print/manual-idempotency";

function keysClient(rows: Array<Record<string, unknown>>, insertError?: { code?: string; message?: string } | null) {
  return {
    from(table: string) {
      if (table !== "idempotency_keys") throw new Error(table);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
            }),
          }),
        }),
        insert: async () => {
          if (insertError) return { error: insertError };
          rows.push({ key: "print:manual:abc", request_hash: "hash" });
          return { error: null };
        },
      };
    },
  };
}

describe("manual print idempotency", () => {
  it("requires an idempotency key", () => {
    expect(() => requirePrintIdempotencyKey(null)).toThrow(AppError);
  });

  it("returns the stored result for the same key and hash", async () => {
    const client = keysClient([
      {
        response: { job: { id: "job-1" } },
        request_hash: printRequestFingerprint({ action: "reprint", jobId: "job-1" }),
        created_at: new Date().toISOString(),
      },
    ]);
    const claimed = await claimManualPrintKey(
      client as never,
      "org-1",
      "abc",
      printRequestFingerprint({ action: "reprint", jobId: "job-1" })
    );
    expect(claimed.cached).toEqual({ job: { id: "job-1" } });
  });

  it("rejects the same key with a different body hash", async () => {
    const client = keysClient([
      {
        response: { job: { id: "job-1" } },
        request_hash: "aaa",
        created_at: new Date().toISOString(),
      },
    ]);
    await expect(
      claimManualPrintKey(client as never, "org-1", "abc", "bbb")
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("treats a concurrent insert as in progress", async () => {
    const claimed = claimManualPrintKey(
      keysClient([], { code: "23505", message: "duplicate key" }) as never,
      "org-1",
      "abc",
      "hash"
    );
    await expect(claimed).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
