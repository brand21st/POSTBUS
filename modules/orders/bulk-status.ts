import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { fulfillSkipReason, orderNumber } from "@/lib/dashboard/records";
import { createShipmentsForOrders } from "@/modules/shipments/service";
import type { BulkOrderStatusResult } from "@/types/api";

type BulkStatusInput = {
  orderIds: string[];
  action: "fulfill";
};

export async function bulkUpdateOrderStatus(
  supabase: SupabaseClient,
  ctx: TenantContext,
  input: BulkStatusInput
): Promise<BulkOrderStatusResult> {
  const uniqueIds = [...new Set(input.orderIds)];
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, order_number, status")
    .eq("organization_id", ctx.organizationId)
    .in("id", uniqueIds);

  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

  const byId = new Map(
    (orders ?? []).map((order) => [
      order.id as string,
      order as { id: string; order_number?: string; status?: string },
    ])
  );

  const skipped: BulkOrderStatusResult["skipped"] = [];
  const failed: BulkOrderStatusResult["failed"] = [];
  const eligible: Array<{ id: string; order_number?: string; status?: string }> = [];

  for (const id of uniqueIds) {
    const order = byId.get(id);
    if (!order) {
      failed.push({ id, reason: "Order was not found in this workspace." });
      continue;
    }
    const reason = fulfillSkipReason(order);
    if (reason) {
      skipped.push({
        id: order.id,
        orderNumber: orderNumber(order),
        reason,
      });
      continue;
    }
    eligible.push(order);
  }

  const updated: BulkOrderStatusResult["updated"] = [];

  if (eligible.length) {
    try {
      const result = await createShipmentsForOrders(
        supabase,
        ctx,
        eligible.map((order) => order.id),
        { action: "fulfill" }
      );
      const skippedIds = new Set(result.skipped ?? []);
      for (const order of eligible) {
        const number = orderNumber(order);
        if (skippedIds.has(order.id)) {
          skipped.push({
            id: order.id,
            orderNumber: number,
            reason: `Order #${number} cannot be marked Booked / packed because it already has an active shipment.`,
          });
        } else {
          updated.push({ id: order.id, orderNumber: number });
        }
      }
    } catch (error) {
      if (error instanceof AppError && error.code === ERROR_CODES.CONFLICT) {
        for (const order of eligible) {
          const number = orderNumber(order);
          skipped.push({
            id: order.id,
            orderNumber: number,
            reason: `Order #${number} cannot be marked Booked / packed because it already has an active shipment.`,
          });
        }
      } else {
        throw error;
      }
    }
  }

  return {
    action: "fulfill",
    selected: uniqueIds.length,
    updated,
    skipped,
    failed,
  };
}
