import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261027120000_sales_invoices.sql", "utf8");

describe("sales invoice migration contract", () => {
  it("lets the service role and org members allocate shipping numbers without renumbering", () => {
    expect(sql).toContain("auth.role() is distinct from 'service_role'");
    expect(sql).toContain("public.is_org_member(p_organization_id)");
    expect(sql).toContain("'INV-' || v_year::text || '-' || lpad(v_next::text, 6, '0')");
  });

  it("allows one live sales invoice per order and keeps automatic issue off", () => {
    expect(sql).toContain("sales_invoices_one_live_order_uidx");
    expect(sql).toContain("where status <> 'CANCELLED' and document_kind = 'SALES'");
    expect(sql).toContain("auto_issue boolean not null default false");
  });

  it("rejects a sales invoice number longer than 16 characters", () => {
    expect(sql).toContain("if length(v_number) > 16 then");
    expect(sql).toContain("grant execute on function public.allocate_sales_invoice_number(uuid, text, text) to authenticated, service_role");
  });
});
