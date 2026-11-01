import { describe, expect, it } from "vitest";

const BASE = process.env.POSTBUS_PROD_URL || "https://www.postbus.in";
const live = process.env.POSTBUS_PROD_QA === "1";

describe.skipIf(!live)("production Support Center read-only HTTP", () => {
  it("returns a healthy API and database without exposing secrets", async () => {
    const response = await fetch(`${BASE}/api/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: { api: string; database: string; jobRunner: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.api).toBe("Healthy");
    expect(body.data.database).toBe("Healthy");
    expect(body.data.jobRunner).toBe("database");
    expect(JSON.stringify(body)).not.toMatch(/service_role|eyJ|sk_live|whsec_/i);
  });

  it("rejects an unsigned Vachat webhook with 403", async () => {
    const response = await fetch(`${BASE}/api/v1/integrations/vachat/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { errors?: { code?: string }[] };
    expect(body.errors?.[0]?.code).toBe("FORBIDDEN");
  });

  it("rejects Support APIs without a session", async () => {
    for (const path of [
      "/api/v1/support/conversations",
      "/api/v1/support/tickets",
      "/api/v1/support/settings",
    ]) {
      const response = await fetch(`${BASE}${path}`);
      expect(response.status).toBe(401);
      const body = (await response.json()) as { errors?: { code?: string }[] };
      expect(body.errors?.[0]?.code).toBe("AUTH_REQUIRED");
    }
  });

  it("rejects Support APIs with an invalid session cookie", async () => {
    const response = await fetch(`${BASE}/api/v1/support/tickets`, {
      headers: { cookie: "sb-access-token=invalid" },
    });
    expect(response.status).toBe(401);
  });
});
