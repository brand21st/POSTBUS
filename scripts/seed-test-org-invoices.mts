/**
 * Generate shipping invoice PDFs for the PostBus test workspace.
 *
 *   npx tsx scripts/seed-test-org-invoices.mts
 *   npx tsx scripts/seed-test-org-invoices.mts --org <uuid>
 */
import { readFileSync } from "node:fs";

const DEFAULT_ORG = "4b6259c8-b20f-4aa6-b260-ef34df86d544";

function loadEnvLocal() {
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // rely on existing env
  }
}

function orgIdFromArgs() {
  const idx = process.argv.indexOf("--org");
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!.trim();
  return DEFAULT_ORG;
}

loadEnvLocal();

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { generateShippingInvoice } = await import("../modules/invoices/service.ts");
const { saveInvoiceSettings } = await import("../modules/invoices/settings.ts");
const { DEFAULT_INVOICE_APPEARANCE } = await import("../modules/invoices/schema.ts");

const organizationId = orgIdFromArgs();
const supabase = createAdminClient();

await saveInvoiceSettings(supabase, organizationId, {
  appearance: DEFAULT_INVOICE_APPEARANCE,
  gstin: "29AABCT1332L1ZP",
  businessEmail: "test@test.com",
  website: "test.postbus.local",
});

const { data: shipments, error: listError } = await supabase
  .from("shipments")
  .select("id, order_id, barcode, tracking_number, orders(order_number)")
  .eq("organization_id", organizationId)
  .not("order_id", "is", null)
  .order("created_at", { ascending: true });

if (listError) {
  console.error(listError.message);
  process.exit(1);
}
if (!shipments?.length) {
  console.error("No shipments for org", organizationId);
  process.exit(1);
}

const results: Array<{
  shipmentId: string;
  orderNumber?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  filePath?: string | null;
  error?: string;
}> = [];

for (const row of shipments) {
  const shipmentId = String(row.id);
  const orderNumber = String((row.orders as { order_number?: string } | null)?.order_number ?? "");
  try {
    let tracking = String(row.tracking_number || row.barcode || "").trim();
    if (!tracking) {
      tracking = `SEED-${orderNumber.replace(/[^A-Z0-9]/gi, "") || shipmentId.slice(0, 8)}`;
      await supabase
        .from("shipments")
        .update({ tracking_number: tracking })
        .eq("id", shipmentId)
        .eq("organization_id", organizationId);
    }

    const invoice = await generateShippingInvoice(supabase, organizationId, shipmentId, { force: true });
    results.push({
      shipmentId,
      orderNumber,
      invoiceId: String(invoice.id),
      invoiceNumber: String(invoice.invoice_number),
      filePath: invoice.file_path,
    });
  } catch (error) {
    results.push({
      shipmentId,
      orderNumber,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(JSON.stringify({ organizationId, results }, null, 2));
process.exit(results.some((r) => r.error) ? 1 : 0);
