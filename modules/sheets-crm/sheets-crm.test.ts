import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encryptSecret } from "@/lib/security/crypto";
import {
  abandonReason,
  classifyCustomer,
  isActiveCustomer,
  lifecycleChanged,
} from "@/modules/sheets-crm/abandonment";
import { mapSheetsCrmConfig, publicSheetsCrmSettings } from "@/modules/sheets-crm/config";
import { renderSheetsCrmScript, sheetsCrmScriptSource } from "@/modules/sheets-crm/script";
import { appsScriptTestFailure, assertSheetsWebAppUrl, deliveryDecision } from "@/modules/sheets-crm/deliver-decision";
import { activitySyncDue, openDedupeKey, type SheetsCrmSnapshot } from "@/modules/sheets-crm/events";
import { enqueueSheetsCrmEvent } from "@/modules/sheets-crm/enqueue";
import { testSheetsCrmConnection } from "@/modules/sheets-crm/deliver";
import { buildSheetPayload, redactCrmError, sheetCell } from "@/modules/sheets-crm/rows";
import { DEFAULT_SHEETS_CRM_THRESHOLDS } from "@/modules/sheets-crm/events";

const NOW = Date.parse("2026-11-12T03:30:00.000Z");
const HOUR = 3_600_000;

function snapshot(overrides: Partial<SheetsCrmSnapshot> = {}): SheetsCrmSnapshot {
  return {
    customerId: "customer-1",
    fullName: "Asha Rao",
    email: "asha@example.com",
    phone: "+919800000000",
    signupAt: new Date(NOW - 2 * HOUR).toISOString(),
    signupSource: "email",
    lastActiveAt: new Date(NOW - HOUR).toISOString(),
    workspaces: [],
    ...overrides,
  };
}

function workspace(overrides: Partial<SheetsCrmSnapshot["workspaces"][number]> = {}) {
  return {
    id: "org-1",
    name: "Asha Stores",
    createdAt: new Date(NOW - 2 * HOUR).toISOString(),
    accountStatus: "ACTIVE",
    indiaPostConnected: false,
    shopifyConnected: false,
    wooConnected: false,
    planName: "Business",
    subscriptionStatus: "TRIAL",
    ...overrides,
  };
}

describe("Google Sheets CRM lifecycle", () => {
  it("keeps a fresh signup out of the abandoned list", () => {
    const row = snapshot();
    expect(abandonReason(row, DEFAULT_SHEETS_CRM_THRESHOLDS, NOW)).toBeNull();
    expect(classifyCustomer(row, DEFAULT_SHEETS_CRM_THRESHOLDS, NOW, null).lifecycle).toBe("signup");
  });

  it("abandons a signup with no workspace after 24 hours", () => {
    const row = snapshot({ signupAt: new Date(NOW - 25 * HOUR).toISOString() });
    const result = classifyCustomer(row, DEFAULT_SHEETS_CRM_THRESHOLDS, NOW, "signup");
    expect(result.lifecycle).toBe("abandoned");
    expect(result.abandonReason).toMatch(/no workspace/i);
    expect(result.leadStatus).toBe("Open");
  });

  it("updates the same customer when India Post connects", () => {
    const before = snapshot({
      signupAt: new Date(NOW - 30 * HOUR).toISOString(),
      workspaces: [workspace({ createdAt: new Date(NOW - 26 * HOUR).toISOString() })],
    });
    expect(classifyCustomer(before, DEFAULT_SHEETS_CRM_THRESHOLDS, NOW, "onboarding").abandonReason).toMatch(/India Post/i);
    const after = snapshot({
      signupAt: before.signupAt,
      workspaces: [workspace({ indiaPostConnected: true, createdAt: before.workspaces[0]!.createdAt })],
    });
    const active = classifyCustomer(after, DEFAULT_SHEETS_CRM_THRESHOLDS, NOW, "abandoned");
    expect(isActiveCustomer(after)).toBe(true);
    expect(active.lifecycle).toBe("recovered");
    expect(active.leadStatus).toBe("Recovered");
    const sheet = buildSheetPayload(after, active, NOW, new Date(NOW).toISOString());
    expect(sheet.signup["Customer ID"]).toBe("customer-1");
    expect(sheet.workspaces[0]?.["Workspace ID"]).toBe("org-1");
    expect(sheet.workspaces[0]?.["India Post Connected"]).toBe("Yes");
    expect(sheet.abandoned?.["Lead Status"]).toBe("Recovered");
    expect(sheet.active?.["Customer ID"]).toBe("customer-1");
  });

  it("marks Shopify on the existing workspace row", () => {
    const row = snapshot({
      workspaces: [workspace({ indiaPostConnected: true, shopifyConnected: true, subscriptionStatus: "ACTIVE" })],
    });
    const sheet = buildSheetPayload(row, classifyCustomer(row, DEFAULT_SHEETS_CRM_THRESHOLDS, NOW, null), NOW, null);
    expect(sheet.workspaces).toHaveLength(1);
    expect(sheet.workspaces[0]?.["Shopify Connected"]).toBe("Yes");
    expect(sheet.signup["Customer ID"]).toBe(sheet.active?.["Customer ID"]);
  });

  it("does not abandon an active merchant who has been quiet", () => {
    const row = snapshot({
      signupAt: new Date(NOW - 20 * 24 * HOUR).toISOString(),
      lastActiveAt: new Date(NOW - 10 * 24 * HOUR).toISOString(),
      workspaces: [workspace({ indiaPostConnected: true, subscriptionStatus: "ACTIVE" })],
    });
    expect(classifyCustomer(row, DEFAULT_SHEETS_CRM_THRESHOLDS, NOW, "active").lifecycle).toBe("active");
  });

  it("flags an expired trial that never became active", () => {
    const row = snapshot({
      signupAt: new Date(NOW - 3 * HOUR).toISOString(),
      workspaces: [workspace({ indiaPostConnected: true, subscriptionStatus: "EXPIRED", createdAt: new Date(NOW - HOUR).toISOString() })],
    });
    expect(classifyCustomer(row, DEFAULT_SHEETS_CRM_THRESHOLDS, NOW, "onboarding").abandonReason).toMatch(/Trial ended/i);
  });

  it("queues a reactivation only when the lifecycle changes", () => {
    const abandoned = classifyCustomer(snapshot({ signupAt: new Date(NOW - 30 * HOUR).toISOString() }), DEFAULT_SHEETS_CRM_THRESHOLDS, NOW, "signup");
    expect(lifecycleChanged("signup", abandoned)).toBe(true);
    expect(lifecycleChanged("abandoned", abandoned)).toBe(false);
    const recovered = classifyCustomer(
      snapshot({ workspaces: [workspace({ indiaPostConnected: true })] }),
      DEFAULT_SHEETS_CRM_THRESHOLDS,
      NOW,
      "abandoned"
    );
    expect(lifecycleChanged("abandoned", recovered)).toBe(true);
    expect(recovered.lifecycle).toBe("recovered");
  });
});

describe("Google Sheets CRM delivery", () => {
  it("retries when Apps Script is unavailable and then accepts the same event", () => {
    expect(deliveryDecision(1, 5, 503, null, "evt_1").status).toBe("FAILED");
    expect(deliveryDecision(5, 5, 503, null, "evt_1").status).toBe("DEAD");
    expect(deliveryDecision(2, 5, 200, { ok: true, processed: ["evt_1"] }, "evt_1").status).toBe("SUCCEEDED");
    expect(deliveryDecision(2, 5, 200, { ok: true, duplicates: ["evt_1"] }, "evt_1").status).toBe("SUCCEEDED");
  });

  it("does not retry a rejected secret", () => {
    expect(deliveryDecision(1, 5, 200, { ok: false, code: "unauthorized" }, "evt_1").status).toBe("DEAD");
  });

  it("treats Google Access denied as a permanent Web App access problem", () => {
    expect(deliveryDecision(1, 5, 403, null, "evt_1")).toMatchObject({ status: "DEAD" });
    expect(appsScriptTestFailure(403, null)).toMatch(/Who has access to Anyone/);
  });

  it("rejects non-Google Web App URLs", () => {
    expect(() => assertSheetsWebAppUrl("http://script.google.com/macros/s/abc/exec")).toThrow(/HTTPS/);
    expect(() => assertSheetsWebAppUrl("https://example.com/exec")).toThrow(/script.google.com/);
    expect(assertSheetsWebAppUrl("https://script.google.com/macros/s/abc/exec")).toContain("script.google.com");
  });

  it("blocks formula injection and email addresses in errors", () => {
    expect(sheetCell("=HYPERLINK(\"https://evil\")")).toMatch(/^'/);
    expect(redactCrmError("failed for asha@example.com")).not.toContain("asha@example.com");
  });

  it("never returns the integration secret from the admin view", () => {
    const secret = "crm-secret-value-123";
    const config = mapSheetsCrmConfig({
      sheets_crm_enabled: true,
      sheets_crm_webapp_url: "https://script.google.com/macros/s/abc/exec",
      encrypted_sheets_crm_secret: encryptSecret(secret),
    });
    const pub = publicSheetsCrmSettings(config);
    expect(JSON.stringify(pub)).not.toContain(secret);
    expect(pub.secretConfigured).toBe(true);
    expect("secret" in pub).toBe(false);
    expect("secretMasked" in pub).toBe(false);
  });

  it("embeds the connection key in the copied Apps Script without exposing it on the dashboard", () => {
    const secret = "crm-secret-value-123";
    const rendered = renderSheetsCrmScript(sheetsCrmScriptSource(), secret);
    expect(rendered).toContain(JSON.stringify(secret));
    expect(sheetsCrmScriptSource()).not.toContain(JSON.stringify(secret));
  });

  it("follows an Apps Script redirect only when it stays on Google", async () => {
    const config = mapSheetsCrmConfig({
      sheets_crm_enabled: true,
      sheets_crm_webapp_url: "https://script.google.com/macros/s/abc/exec",
      encrypted_sheets_crm_secret: encryptSecret("crm-secret-value-123"),
    });
    const urls: string[] = [];
    await testSheetsCrmConnection(config, async (url) => {
      urls.push(url);
      if (urls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://script.googleusercontent.com/macros/echo?user_content_key=abc" },
        });
      }
      return Response.json({ ok: true, test: true });
    });
    expect(urls[1]).toContain("script.googleusercontent.com");
    await expect(
      testSheetsCrmConnection(config, async () => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }))
    ).rejects.toThrow(/script.google.com/);
  });

  it("throttles activity syncs for six hours", () => {
    expect(activitySyncDue(new Date(NOW - 60_000).toISOString(), NOW)).toBe(false);
    expect(activitySyncDue(new Date(NOW - 7 * HOUR).toISOString(), NOW)).toBe(true);
  });

  it("coalesces a duplicate open event for the same customer", async () => {
    const secret = encryptSecret("crm-secret-value-123");
    const steps: Array<{ data?: unknown; error?: { code?: string; message?: string } | null; count?: number }> = [
      {
        data: {
          sheets_crm_enabled: true,
          sheets_crm_webapp_url: "https://script.google.com/macros/s/abc/exec",
          encrypted_sheets_crm_secret: secret,
        },
        error: null,
      },
      { data: null, error: null },
      { error: { code: "23505" } },
    ];
    const supabase = {
      from() {
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.select = chain;
        builder.eq = chain;
        builder.in = chain;
        builder.limit = chain;
        builder.update = chain;
        builder.maybeSingle = async () => steps.shift();
        builder.insert = async () => steps.shift();
        builder.then = (resolve: (value: unknown) => void) => resolve(steps.shift());
        return builder;
      },
    };
    const result = await enqueueSheetsCrmEvent(supabase as never, {
      eventType: "customer.signup.completed",
      customerId: "11111111-1111-1111-1111-111111111111",
    });
    expect(result).toMatchObject({ queued: false, reason: "duplicate" });
    expect(openDedupeKey("11111111-1111-1111-1111-111111111111")).toBe(
      "open:11111111-1111-1111-1111-111111111111"
    );
  });
});

describe("Google Apps Script CRM receiver", () => {
  const source = readFileSync(path.join(process.cwd(), "modules", "sheets-crm", "apps-script", "Code.gs"), "utf8");

  it("authenticates from the POST body and locks sheet writes", () => {
    expect(source).toContain("e.postData.contents");
    expect(source).toContain("LockService.getScriptLock");
    expect(source).toContain("function safeCell_");
    expect(source).toContain("EMBEDDED_CRM_SECRET");
    expect(source).toContain("SpreadsheetApp.getActiveSpreadsheet");
    expect(source).not.toContain("e.headers");
    expect(source).toContain("All Signups");
    expect(source).toContain("Abandoned Clients");
  });
});
