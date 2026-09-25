import { latestPrintJob, printStatusForJob } from "@/modules/print/service";

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
  const jobsRaw = row.print_jobs;
  const jobs = Array.isArray(jobsRaw) ? jobsRaw : jobsRaw ? [jobsRaw] : [];
  const printJob = latestPrintJob(jobs as { created_at?: string; status?: string; error_message?: string }[]) as
    | { status?: string; error_message?: string }
    | null;
  const printStatus = printStatusForJob(printJob);
  const fileUrl = (row.file_url as string | null | undefined) ?? (row.fileUrl as string | null | undefined) ?? null;
  const shipmentId = String(row.shipment_id || row.shipmentId || "");
  return {
    ...row,
    kind: String(row.kind || "INDIA_POST"),
    shipmentId,
    shipment_id: shipmentId,
    fileUrl,
    file_url: fileUrl,
    trackingNumber: tracking,
    tracking_number: tracking,
    barcode: shipment?.barcode ?? null,
    orderNumber,
    order_number: orderNumber,
    printStatus,
    print_status: printStatus,
    printError: printJob?.error_message ?? null,
    print_error: printJob?.error_message ?? null,
    printJob,
    print_job: printJob,
  };
}
