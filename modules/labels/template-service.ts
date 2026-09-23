import type { SupabaseClient } from "@supabase/supabase-js";
import { packingDataForOrganization } from "@/modules/labels/packing-data";
import { renderMerchantLabelPdf } from "@/modules/labels/packing-pdf";
import { persistLabelPdf } from "@/modules/labels/persist";
import { defaultLabelTemplate, parseLabelTemplate, type LabelTemplate } from "@/modules/labels/template-schema";

export async function getLabelTemplate(supabase: SupabaseClient, organizationId: string): Promise<LabelTemplate> {
  const { data } = await supabase
    .from("label_templates")
    .select("template")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return parseLabelTemplate(data?.template);
}

export async function saveLabelTemplate(
  supabase: SupabaseClient,
  organizationId: string,
  template: LabelTemplate
) {
  const parsed = parseLabelTemplate(template);
  const { error } = await supabase.from("label_templates").upsert({
    organization_id: organizationId,
    template: parsed,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  return parsed;
}

export async function persistMerchantPackingLabel(
  supabase: SupabaseClient,
  input: { organizationId: string; shipmentId: string; template?: LabelTemplate }
) {
  const template = input.template ?? (await getLabelTemplate(supabase, input.organizationId));
  const { data } = await packingDataForOrganization(supabase, input.organizationId, input.shipmentId);
  const bytes = await renderMerchantLabelPdf(template, data);
  const label = await persistLabelPdf(supabase, {
    organizationId: input.organizationId,
    shipmentId: input.shipmentId,
    kind: "MERCHANT",
    bytes: Buffer.from(bytes),
    templateSnapshot: template,
  });
  return { ...label, paperSize: template.page.paperSize };
}

export { defaultLabelTemplate, parseLabelTemplate };
