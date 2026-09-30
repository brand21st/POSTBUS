import { afterEach, describe, expect, it, vi } from "vitest";

const hasAdminClient = vi.fn(() => false);
const rpc = vi.fn(async () => ({ data: 0, error: null }));

vi.mock("@/lib/supabase/admin", () => ({
  hasAdminClient: () => hasAdminClient(),
  createAdminClient: () => ({ rpc }),
}));

async function loadHealth() {
  vi.resetModules();
  return import("@/lib/api/health");
}

describe("getSystemHealth public database signal", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    hasAdminClient.mockReturnValue(false);
    rpc.mockResolvedValue({ data: 0, error: null });
  });

  it("reports Healthy when GoTrue health returns OK with the anon key", async () => {
    vi.stubEnv("JOB_RUNNER", "database");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-public-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("apikey")).toBe("anon-public-key");
      expect(headers.get("authorization")).toBe("Bearer anon-public-key");
      expect(headers.get("apikey")).not.toBe("service-role-secret");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getSystemHealth } = await loadHealth();
    const health = await getSystemHealth();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/auth/v1/health",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(health.database).toBe("Healthy");
    expect(JSON.stringify(health)).not.toContain("service-role-secret");
    expect(JSON.stringify(health)).not.toContain("anon-public-key");
  });

  it("reports Error when GoTrue health is not OK", async () => {
    vi.stubEnv("JOB_RUNNER", "database");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-public-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));

    const { getSystemHealth } = await loadHealth();
    const health = await getSystemHealth();

    expect(health.database).toBe("Error");
    expect(health.api).toBe("Healthy");
  });

  it("reports Error when public Supabase URL or anon key is missing", async () => {
    vi.stubEnv("JOB_RUNNER", "database");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { getSystemHealth } = await loadHealth();
    const health = await getSystemHealth();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(health.database).toBe("Error");
  });

  it("keeps jobs health independent of the database Auth Health result", async () => {
    vi.stubEnv("JOB_RUNNER", "database");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-public-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    hasAdminClient.mockReturnValue(true);
    rpc.mockResolvedValue({ data: 4, error: null });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

    const { getSystemHealth } = await loadHealth();
    const health = await getSystemHealth();

    expect(health.database).toBe("Healthy");
    expect(health.jobs).toBe("Warning");
  });
});
