import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("consume_order_quota authorization migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20261030154500_revoke_consume_order_quota_authenticated.sql"),
    "utf8"
  );

  it("revokes end-user execute and keeps service_role", () => {
    expect(sql).toMatch(/revoke all on function public\.consume_order_quota\(uuid, integer\) from authenticated/i);
    expect(sql).toMatch(/revoke all on function public\.consume_order_quota\(uuid, integer\) from anon/i);
    expect(sql).toMatch(/grant execute on function public\.consume_order_quota\(uuid, integer\) to service_role/i);
    expect(sql).not.toMatch(/grant execute on function public\.consume_order_quota\(uuid, integer\) to service_role, authenticated/i);
  });
});
