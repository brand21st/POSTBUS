import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWhatsAppOrderCommand, yesNoInteractive } from "@/modules/orders/whatsapp-commands";
import { canonicalOrderNumber, formatWhatsAppOrderNumber } from "@/modules/orders/order-number";

const waMigration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261008161000_next_wa_pb_order_number.sql"),
  "utf8"
);
const pbMigration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261008103000_next_pb_order_number_lock.sql"),
  "utf8"
);
const commerce = readFileSync(path.join(process.cwd(), "lib/api/v1/commerce.ts"), "utf8");

describe("WA-PB order id security", () => {
  it("revokes anon/public execute and grants only authenticated + service_role", () => {
    expect(waMigration).toContain("security invoker");
    expect(waMigration).toContain("set search_path = public");
    expect(waMigration).toContain("revoke all on function public.next_wa_pb_order_number(uuid) from public, anon");
    expect(waMigration).toContain(
      "grant execute on function public.next_wa_pb_order_number(uuid) to authenticated, service_role"
    );
  });

  it("uses a distinct advisory lock from the dashboard PB allocator", () => {
    expect(pbMigration).toContain("pg_advisory_xact_lock(87251403,");
    expect(waMigration).toContain("pg_advisory_xact_lock(87251404,");
    expect(waMigration).not.toContain("87251403");
  });

  it("does not let the dashboard API mint WhatsApp orders", () => {
    expect(commerce).toContain('if ((body.source ?? "MANUAL") === "WHATSAPP")');
    expect(commerce).toContain("WhatsApp orders must be created from the storefront.");
  });

  it("does not treat free text or SQL-looking payloads as order commands", () => {
    expect(parseWhatsAppOrderCommand("YES; drop table orders")).toBeNull();
    expect(parseWhatsAppOrderCommand("PROCESS *")).toBeNull();
    expect(parseWhatsAppOrderCommand("YES WA-PB-abc")).toBeNull();
    expect(parseWhatsAppOrderCommand("I HAVE PAID")).toBeNull();
  });

  it("canonicalizes display hashes so button ids cannot carry # into reply payloads", () => {
    expect(canonicalOrderNumber("#WA-PB-10001")).toBe("WA-PB-10001");
    expect(formatWhatsAppOrderNumber("WA-PB-10001")).toBe("#WA-PB-10001");
    const buttons = yesNoInteractive("#wa-pb-10001").action.buttons;
    expect(buttons.map((button) => button.reply.id)).toEqual(["yes:WA-PB-10001", "no:WA-PB-10001"]);
    expect(JSON.stringify(buttons)).not.toContain("#");
  });
});
