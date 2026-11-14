import { describe, expect, it } from "vitest";
import {
  ABANDONED_EXPORT_HEADERS,
  WORKSPACE_EXPORT_HEADERS,
  abandonedExportRows,
  accountExportFilename,
  parseAccountExportTab,
  workspaceExportRows,
} from "@/lib/admin/account-export";

describe("workspaceExportRows", () => {
  it("puts every workspace column in header order and converts paise to rupees", () => {
    const rows = workspaceExportRows([
      {
        id: "org-1",
        name: "Kala Ghar",
        slug: "kala-ghar",
        account_status: "ACTIVE",
        created_at: "2026-11-01T04:30:00.000Z",
        lastActiveAt: "2026-11-12T02:00:00.000Z",
        planName: "Growth",
        subscriptionStatus: "ACTIVE",
        billingCycle: "MONTHLY",
        amountPaise: 19900,
        ownerName: "Asha",
        ownerEmail: "asha@example.com",
        ownerWhatsapp: "919876543210",
      },
    ]);

    expect(rows[0]).toEqual([...WORKSPACE_EXPORT_HEADERS]);
    expect(rows[1]).toEqual([
      "Kala Ghar",
      "kala-ghar",
      "ACTIVE",
      "Growth",
      "ACTIVE",
      "MONTHLY",
      199,
      "Asha",
      "asha@example.com",
      "919876543210",
      "2026-11-12T02:00:00.000Z",
      "2026-11-01T04:30:00.000Z",
      "org-1",
    ]);
  });

  it("leaves missing workspace values blank and keeps a header-only sheet", () => {
    expect(workspaceExportRows([])).toEqual([[...WORKSPACE_EXPORT_HEADERS]]);
    expect(
      workspaceExportRows([
        {
          id: "org-2",
          name: null,
          slug: null,
          account_status: null,
          created_at: null,
          lastActiveAt: null,
          planName: null,
          subscriptionStatus: null,
          billingCycle: null,
          amountPaise: null,
          ownerName: null,
          ownerEmail: null,
          ownerWhatsapp: null,
        },
      ])[1]
    ).toEqual(["", "", "", "", "", "", "", "", "", "", "", "", "org-2"]);
  });
});

describe("abandonedExportRows", () => {
  it("exports every abandoned signup field and blanks missing ones", () => {
    const rows = abandonedExportRows([
      {
        id: "user-1",
        full_name: "Ravi",
        email: "ravi@example.com",
        whatsapp_number: "919800000000",
        pincode: "560001",
        city: "Bengaluru",
        created_at: "2026-10-02T10:00:00.000Z",
      },
      {
        id: "user-2",
        full_name: null,
        email: null,
        whatsapp_number: null,
        pincode: null,
        city: null,
        created_at: null,
      },
    ]);

    expect(rows[0]).toEqual([...ABANDONED_EXPORT_HEADERS]);
    expect(rows[1]).toEqual([
      "Ravi",
      "ravi@example.com",
      "919800000000",
      "560001",
      "Bengaluru",
      "2026-10-02T10:00:00.000Z",
      "user-1",
    ]);
    expect(rows[2]).toEqual(["", "", "", "", "", "", "user-2"]);
  });
});

describe("parseAccountExportTab", () => {
  it("accepts workspaces and abandoned only", () => {
    expect(parseAccountExportTab("workspaces")).toBe("workspaces");
    expect(parseAccountExportTab("abandoned")).toBe("abandoned");
    expect(() => parseAccountExportTab("signups")).toThrow(/workspaces and abandoned/i);
    expect(() => parseAccountExportTab(null)).toThrow(/workspaces and abandoned/i);
  });
});

describe("accountExportFilename", () => {
  it("names the workbook from the tab and calendar date", () => {
    expect(accountExportFilename("workspaces", "2026-11-12")).toBe("postbus-workspaces-2026-11-12.xlsx");
    expect(accountExportFilename("abandoned", "2026-11-12")).toBe("postbus-abandoned-2026-11-12.xlsx");
  });
});
