import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";

export type LabelSheetMember = {
  orderId: string;
  shipmentId: string;
  orderUuid: string;
};

export async function insertLabelSheetMembers(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    labelId: string;
    members: LabelSheetMember[];
  }
) {
  const seen = new Set<string>();
  const rows = [];
  for (const member of input.members) {
    if (!member.shipmentId || seen.has(member.shipmentId)) continue;
    seen.add(member.shipmentId);
    rows.push({
      organization_id: input.organizationId,
      label_id: input.labelId,
      shipment_id: member.shipmentId,
      order_id: member.orderUuid,
      position: rows.length,
    });
  }
  if (!rows.length) {
    throw new AppError(ERROR_CODES.LABEL_GENERATION_FAILED, "The sheet has no shipments to record.");
  }
  const { error } = await supabase.from("label_sheet_members").insert(rows);
  if (error) {
    throw new AppError(ERROR_CODES.LABEL_GENERATION_FAILED, error.message || "Could not record sheet shipments.");
  }
  return rows;
}
