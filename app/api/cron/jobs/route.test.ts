import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const drainDueJobs = vi.fn();

vi.mock("@/lib/jobs/drain", () => ({
  DEFAULT_DRAIN_LIMIT: 20,
  drainDueJobs: (...args: unknown[]) => drainDueJobs(...args),
}));

vi.mock("@/lib/jobs/cron-auth", () => ({
  authorizeCron: () => ({ authorized: true }),
}));

vi.mock("@/lib/env", () => ({
  env: { jobRunner: "database", cronSecret: "secret" },
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

import { POST } from "@/app/api/cron/jobs/route";

describe("POST /api/cron/jobs types", () => {
  beforeEach(() => {
    drainDueJobs.mockReset();
    drainDueJobs.mockResolvedValue({ claimed: 0, succeeded: 0, failed: 0 });
  });

  it("rejects unknown types", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/cron/jobs?types=label-generation,nope")
    );
    expect(response.status).toBe(400);
    expect(drainDueJobs).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ success: false });
  });

  it("passes parsed types to drainDueJobs", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/cron/jobs?types=label-generation")
    );
    expect(response.status).toBe(200);
    expect(drainDueJobs).toHaveBeenCalledWith(20, ["label-generation"]);
  });
});
