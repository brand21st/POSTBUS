import { describe, expect, it, vi } from "vitest";
import { resetWatiConnection } from "@/modules/wati/service";

describe("resetWatiConnection", () => {
  it("deletes Wati notify jobs and the org connection row", async () => {
    const deletes: Array<{ table: string; filters: Array<[string, string]> }> = [];
    const supabase = {
      from: (table: string) => {
        const filters: Array<[string, string]> = [];
        const api = {
          delete: () => api,
          eq: (column: string, value: string) => {
            filters.push([column, value]);
            return api;
          },
          then: (resolve: (value: { error: null }) => unknown) => {
            deletes.push({ table, filters });
            return Promise.resolve({ error: null }).then(resolve);
          },
        };
        return api;
      },
    };
    await expect(resetWatiConnection(supabase as never, "org-1")).resolves.toEqual({ reset: true });
    expect(deletes).toEqual([
      {
        table: "background_jobs",
        filters: [
          ["organization_id", "org-1"],
          ["job_type", "wati-notify"],
        ],
      },
      { table: "wati_connections", filters: [["organization_id", "org-1"]] },
    ]);
  });

  it("throws when the connection delete fails", async () => {
    const supabase = {
      from: (table: string) => {
        const api = {
          delete: () => api,
          eq: () => api,
          then: (resolve: (value: { error: { message: string } | null }) => unknown) =>
            Promise.resolve({
              error: table === "wati_connections" ? { message: "denied" } : null,
            }).then(resolve),
        };
        return api;
      },
    };
    await expect(resetWatiConnection(supabase as never, "org-1")).rejects.toThrow(/denied/);
  });
});
