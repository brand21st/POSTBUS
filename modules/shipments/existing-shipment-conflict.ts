import { AppError, ERROR_CODES } from "@/lib/api/errors";

export type ExistingShipmentBlock = {
  orderId: string;
  shipmentId?: string;
  action?: string;
  reason?: string;
};

/**
 * One reason for every blocked order, with the shipment the merchant should open.
 * A shared reason is returned as-is so the orders screen can offer Force book or a link.
 */
export function existingShipmentConflict(blocks: ExistingShipmentBlock[]) {
  const explained = blocks.filter((row) => row.reason);
  const first = explained[0];
  const same =
    Boolean(first) &&
    explained.every((row) => row.reason === first.reason && row.action === first.action);
  if (first && (explained.length === 1 || same)) {
    return new AppError(ERROR_CODES.CONFLICT, first.reason as string, {
      action: first.action,
      shipmentId: first.shipmentId,
      orderId: explained.length === 1 ? first.orderId : undefined,
    });
  }
  if (blocks.length === 1) {
    return new AppError(
      ERROR_CODES.CONFLICT,
      "This order already has a shipment. Open the shipment to retry or cancel it.",
      { shipmentId: blocks[0]?.shipmentId, orderId: blocks[0]?.orderId }
    );
  }
  return new AppError(ERROR_CODES.CONFLICT, "Every selected order already has a shipment.");
}
