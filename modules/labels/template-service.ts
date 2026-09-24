import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLabelTemplate, type LabelTemplate } from "@/modules/labels/template-schema";

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
