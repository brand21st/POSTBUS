import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/hooks/use-api", () => ({ api: vi.fn() }));

const { default: AdminSettingsPage } = await import("./page");

const platformLog = {
  id: "log-platform",
  organization_id: null,
  event: "abandoned_signup",
  phone: "918618456029",
  external_ref: "postbus:abandoned_signup:u1",
  status: "sent",
  error: null,
  created_at: "2026-11-02T03:00:00.000Z",
};

const orgLog = {
  id: "log-org",
  organization_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  event: "booked",
  phone: "919999999999",
  external_ref: "order-1",
  status: "sent",
  error: null,
  created_at: "2026-11-02T03:01:00.000Z",
};

function seedClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["admin", "settings", "razorpay"], {
    connected: false,
    keyId: "",
    keyIdMasked: "",
    keySecretConfigured: false,
    webhookSecretConfigured: false,
    webhookConfigured: false,
    webhookId: null,
    webhookUrl: "",
    webhookEvents: [],
    mode: "test",
    source: "none",
  });
  client.setQueryData(["admin", "settings", "openrouter"], {
    connected: false,
    enabled: false,
    hasApiKey: false,
    keyMasked: "",
    model: "openai/gpt-4o-mini",
    source: "none",
  });
  client.setQueryData(["admin", "settings", "openrouter", "models"], {
    models: "not-an-array",
    selected: "openai/gpt-4o-mini",
  });
  client.setQueryData(["admin", "settings", "vachat"], {
    enabled: false,
    connected: false,
    status: "idle",
    apiBaseUrl: "https://cloud.vachat.in",
    hasApiKey: false,
    keyMasked: "",
    webhookSecretConfigured: false,
    webhookEndpointId: null,
    webhookUrl: "",
    lastVerifiedAt: null,
    lastError: null,
    lastTestPhone: null,
    eventSettings: {},
    source: "none",
  });
  client.setQueryData(["admin", "settings", "vachat", "stats"], { today: {}, last7d: {}, last30d: {} });
  client.setQueryData(["admin", "settings", "vachat", "logs"], [platformLog, orgLog]);
  client.setQueryData(["admin", "settings", "vachat", "unassigned"], { items: null, count: 0, counts: {} });
  return client;
}

describe("Admin system settings", () => {
  it("renders platform logs with a null organization_id instead of crashing", () => {
    const organizationId: string | null = platformLog.organization_id;
    expect(() => organizationId!.slice(0, 8)).toThrow();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={seedClient()}>
        <AdminSettingsPage />
      </QueryClientProvider>
    );
    expect(html).toContain("platform");
    expect(html).toContain("aaaaaaaa");
    expect(html).toContain("abandoned_signup");
  });
});
