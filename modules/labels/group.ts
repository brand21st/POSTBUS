import { mapLabelRow } from "@/modules/labels/map";

export type MappedLabelRow = ReturnType<typeof mapLabelRow> & {
  packingLabelId?: string | null;
  packing_label_id?: string | null;
  indiaPostLabelId?: string | null;
  india_post_label_id?: string | null;
  packingStatus?: string | null;
  packing_status?: string | null;
  barcodeStatus?: string | null;
  barcode_status?: string | null;
};

function isMerchant(kind?: string | null) {
  return String(kind || "INDIA_POST").toUpperCase() === "MERCHANT";
}

function shipmentKey(row: { shipmentId?: string; shipment_id?: string; id: string }) {
  return String(row.shipmentId || row.shipment_id || row.id);
}

function createdMs(row: { createdAt?: unknown; created_at?: unknown }) {
  const raw = String(row.createdAt ?? row.created_at ?? "");
  const time = Date.parse(raw);
  return Number.isNaN(time) ? 0 : time;
}

export function groupLabelsByShipment(rows: ReturnType<typeof mapLabelRow>[]): MappedLabelRow[] {
  const order: string[] = [];
  const groups = new Map<string, MappedLabelRow>();

  for (const row of rows) {
    const key = shipmentKey(row);
    const merchant = isMerchant(row.kind);
    const existing = groups.get(key);
    if (!existing) {
      order.push(key);
      groups.set(key, {
        ...row,
        indiaPostLabelId: merchant ? null : row.id,
        india_post_label_id: merchant ? null : row.id,
        packingLabelId: merchant ? row.id : null,
        packing_label_id: merchant ? row.id : null,
        barcodeStatus: merchant ? null : String(row.status || ""),
        barcode_status: merchant ? null : String(row.status || ""),
        packingStatus: merchant ? String(row.status || "") : null,
        packing_status: merchant ? String(row.status || "") : null,
      });
      continue;
    }

    if (merchant) {
      if (!existing.packingLabelId) {
        existing.packingLabelId = row.id;
        existing.packing_label_id = row.id;
        existing.packingStatus = String(row.status || "");
        existing.packing_status = String(row.status || "");
      }
    } else if (!existing.indiaPostLabelId) {
      existing.indiaPostLabelId = row.id;
      existing.india_post_label_id = row.id;
      existing.barcodeStatus = String(row.status || "");
      existing.barcode_status = String(row.status || "");
      if (isMerchant(existing.kind)) {
        const packingId = existing.packingLabelId ?? null;
        const packingStatus = existing.packingStatus ?? null;
        Object.assign(existing, row, {
          packingLabelId: packingId,
          packing_label_id: packingId,
          packingStatus,
          packing_status: packingStatus,
          indiaPostLabelId: row.id,
          india_post_label_id: row.id,
          barcodeStatus: String(row.status || ""),
          barcode_status: String(row.status || ""),
        });
      }
    }

    if (createdMs(row) > createdMs(existing)) {
      existing.createdAt = (row.createdAt ?? row.created_at) as string | undefined;
      existing.created_at = (row.created_at ?? row.createdAt) as string | undefined;
    }
  }

  return order.map((key) => groups.get(key)!);
}

export function filterGroupedLabels(rows: MappedLabelRow[], kind?: string | null) {
  const value = String(kind || "ALL").toUpperCase();
  if (value === "INDIA_POST") return rows.filter((row) => Boolean(row.indiaPostLabelId));
  if (value === "MERCHANT") return rows.filter((row) => Boolean(row.packingLabelId));
  if (value === "COMPLETE") return rows.filter((row) => Boolean(row.indiaPostLabelId && row.packingLabelId));
  if (value === "INCOMPLETE") return rows.filter((row) => !row.indiaPostLabelId || !row.packingLabelId);
  return rows;
}

export function paginateGroupedLabels<T>(items: T[], page: number, pageSize: number) {
  const safePage = Math.max(1, page || 1);
  const size = Math.max(1, pageSize || 20);
  const from = (safePage - 1) * size;
  return {
    items: items.slice(from, from + size),
    page: safePage,
    pageSize: size,
    total: items.length,
  };
}
