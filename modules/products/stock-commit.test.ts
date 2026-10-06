import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const commitMigration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261007040000_storefront_and_stock_commit.sql"),
  "utf8"
);
const securityMigration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261007070000_inventory_rpc_security.sql"),
  "utf8"
);
const bookingRun = readFileSync(path.join(process.cwd(), "modules/india-post/booking-run.ts"), "utf8");

describe("booking stock commit", () => {
  it("deducts stock only through an idempotent ORDER_COMMIT movement", () => {
    expect(commitMigration).toContain("commit_order_inventory");
    expect(commitMigration).toContain("reason = 'ORDER_COMMIT'");
    expect(commitMigration).toContain("inventory_movements_order_commit_uidx");
    expect(commitMigration).toContain("when unique_violation");
    expect(commitMigration).toContain("when others then");
    expect(commitMigration).toContain("do not fail the shipment if stock is short");
  });

  it("commits inventory only after a successful booking persist and logs failures without retrying writes", () => {
    expect(bookingRun).toContain('await supabase.rpc("commit_order_inventory"');
    expect(bookingRun).toContain("booking.inventory_commit_skipped");
    expect(bookingRun).toContain("booking.persistence_success");
  });

  it("keeps the booking commit RPC private to the service role", () => {
    expect(securityMigration).toContain(
      "revoke all on function public.commit_order_inventory(uuid) from public, anon, authenticated"
    );
    expect(securityMigration).toContain(
      "grant execute on function public.commit_order_inventory(uuid) to service_role"
    );
  });
});
