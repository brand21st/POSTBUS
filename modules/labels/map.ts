type NestedShipment = {
  barcode?: string | null;
  tracking_number?: string | null;
  orders?: { order_number?: string | null } | { order_number?: string | null }[] | null;
};

function firstNested<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function trackingIdFromShipment(shipment: NestedShipment | null) {
  const barcode = shipment?.barcode?.trim();
  const tracking = shipment?.tracking_number?.trim();
  return barcode || tracking || null;
}

export function mapLabelRow(row: Record<string, unknown>) {
  const shipment = firstNested(row.shipments as NestedShipment | NestedShipment[] | null);
  const order = firstNested(shipment?.orders);
  const tracking = trackingIdFromShipment(shipment);
  const orderNumber = order?.order_number ?? null;
  return {
    ...row,
    trackingNumber: tracking,
    tracking_number: tracking,
    barcode: shipment?.barcode ?? null,
    orderNumber,
    order_number: orderNumber,
  };
}
