/**
 * Generate READY label PDFs (MERCHANT + INDIA_POST) for the PostBus test workspace.
 *
 *   npx tsx scripts/seed-test-org-labels.mts
 *   npx tsx scripts/seed-test-org-labels.mts --org <uuid>
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
const { loadPackingLabelData, persistPackingSlip } = await import("../modules/labels/packing-fetch.ts");
const { renderMerchantLabelPdf } = await import("../modules/labels/packing-pdf.ts");
const { persistLabelPdf } = await import("../modules/labels/persist.ts");
const { indiaPostLabelTemplate } = await import("../modules/labels/template-schema.ts");

const organizationId = orgIdFromArgs();
const supabase = createAdminClient();

const { data: shipments, error: listError } = await supabase
  .from("shipments")
  .select("id, barcode, status")
  .eq("organization_id", organizationId)
  .order("created_at", { ascending: true });

if (listError) {
  console.error(listError.message);
  process.exit(1);
}
if (!shipments?.length) {
  console.error("No shipments for org", organizationId);
  process.exit(1);
}

const results: Array<{ shipmentId: string; merchant?: string; indiaPost?: string; error?: string }> = [];

for (const row of shipments) {
  const shipmentId = String(row.id);
  try {
    const merchant = await persistPackingSlip(supabase, organizationId, shipmentId, { replace: true });

    const loaded = await loadPackingLabelData(supabase, organizationId, shipmentId);
    const template = indiaPostLabelTemplate();
    const pdf = Buffer.from(await renderMerchantLabelPdf(template, loaded.data));
    const indiaPost = await persistLabelPdf(supabase, {
      organizationId,
      shipmentId,
      kind: "INDIA_POST",
      bytes: pdf,
      templateSnapshot: template,
    });

    await supabase
      .from("shipments")
      .update({
        status: "LABEL_READY",
        last_error: null,
        last_error_code: null,
      })
      .eq("id", shipmentId)
      .eq("organization_id", organizationId);

    results.push({
      shipmentId,
      merchant: merchant.id,
      indiaPost: indiaPost.id,
    });
  } catch (error) {
    results.push({
      shipmentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(JSON.stringify({ organizationId, results }, null, 2));
const failed = results.filter((r) => r.error);
process.exit(failed.length ? 1 : 0);
