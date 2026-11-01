import { describe, expect, it } from "vitest";
import { listPageRange, parseAdminAccountListParams } from "@/lib/admin/account-list";

describe("parseAdminAccountListParams", () => {
  it("defaults to workspaces page 1 with 25 rows", () => {
    expect(parseAdminAccountListParams(new URLSearchParams())).toEqual({
      tab: "workspaces",
      page: 1,
      pageSize: 25,
      status: "",
    });
  });

  it("parses signup pagination and a valid status filter", () => {
    expect(
      parseAdminAccountListParams(
        new URLSearchParams("tab=signups&page=3&pageSize=50&status=hold")
      )
    ).toEqual({
      tab: "signups",
      page: 3,
      pageSize: 50,
      status: "HOLD",
    });
  });

  it("parses the abandoned signups tab", () => {
    expect(parseAdminAccountListParams(new URLSearchParams("tab=abandoned&page=2"))).toEqual({
      tab: "abandoned",
      page: 2,
      pageSize: 25,
      status: "",
    });
  });
});

describe("listPageRange", () => {
  it("clamps past the last page and reports the exact total window", () => {
    expect(listPageRange(9, 25, 50)).toEqual({
      page: 2,
      pageCount: 2,
      from: 25,
      to: 49,
      total: 50,
    });
  });
});
