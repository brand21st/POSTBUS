import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { logError } from "@/lib/logger";
import { drawBarcode } from "@/modules/invoices/pdf";
import { indiaPostVolumetricWeightGrams } from "@/modules/india-post/endpoints";
import { cachedOfficeLookup, resolveIndiaPostOrigin } from "@/modules/india-post/origin";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import { persistIndiaPostTokens } from "@/modules/india-post/session";
import { articleIdFromShipment } from "@/modules/labels/india-post-barcode-image";
import { organizationLabelSender } from "@/modules/organizations/label-sender";
import { indiaPostServiceLabel } from "@/types/domain";

const PAGE_WIDTH = 419.53;
const PAGE_HEIGHT = 595.28;
const MARGIN = 28;

export type ReceiptParty = { name: string; phone: string; lines: string[] };

export type ReceiptData = {
  articleId: string;
  service: string;
  bookingRefId: string;
  invoiceNo: string;
  bookingDate: string;
  bookingOffice: string;
  destinationOffice: string;
  customerId: string;
  contractId: string;
  orderNumber: string;
  paymentMode: string;
  physicalWeightGrams: number | null;
  volumetricWeightGrams: number | null;
  chargedWeightGrams: number | null;
  dimensions: string;
  tariff: number | null;
  codAmount: number;
  sender: ReceiptParty;
  receiver: ReceiptParty;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) ?? null;
  if (typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function text(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function numberOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function phone10(value: unknown) {
  const digits = text(value).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function istDateTime(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function withPin(name: string, pin: string) {
  if (!name) return "";
  return pin ? `${name} (${pin})` : name;
}

function addressLines(input: { line1?: unknown; line2?: unknown; city?: unknown; state?: unknown; pincode?: unknown }) {
  const street = [text(input.line1), text(input.line2)].filter(
    (value) => value && !/^registered\s*pickup$/i.test(value)
  );
  const locality = [text(input.city), text(input.state)].filter(Boolean).join(", ");
  const pin = text(input.pincode);
  const last = [locality, pin].filter(Boolean).join(" - ");
  return [...street, last].filter(Boolean);
}

/** Latest CEPT webhook payload for the article; carries invoice_no, offices and charged weight. */
async function latestIndiaPostEvent(supabase: SupabaseClient, organizationId: string, articleId: string) {
  const { data } = await supabase
    .from("provider_webhook_inbox")
    .select("raw_payload")
    .eq("organization_id", organizationId)
    .eq("tracking_number", articleId)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return asRecord(data?.raw_payload);
}

/** Same origin/delivery office resolution the label request uses; receipts still render if it fails. */
async function resolveOffices(
  supabase: SupabaseClient,
  organizationId: string,
  connection: Record<string, unknown>,
  pickup: Record<string, unknown> | null,
  sender: { pincode?: string | null; city?: string | null; state?: string | null },
  destPin: string
) {
  try {
    const provider = indiaPostFromRow(connection as Parameters<typeof indiaPostFromRow>[0]);
    const session = await provider.ensureSession();
    if (!session.reused && session.tokens) {
      await persistIndiaPostTokens(supabase, connection as Parameters<typeof persistIndiaPostTokens>[1], session.tokens);
    }
    const origin = await resolveIndiaPostOrigin(
      cachedOfficeLookup(provider),
      connection,
      {
        ...pickup,
        pincode: sender.pincode || (pickup?.pincode as string | undefined),
        city: sender.city || (pickup?.city as string | undefined),
        state: sender.state || (pickup?.state as string | undefined),
      },
      destPin
    );
    return {
      booking: withPin(origin.name, origin.pincode),
      delivery: withPin(text(origin.deliveryOfficeName), destPin),
    };
  } catch (error) {
    logError("RECEIPT_OFFICE_LOOKUP_FAILED", {
      organizationId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return { booking: "", delivery: "" };
  }
}

export async function loadReceiptData(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentId: string
): Promise<ReceiptData> {
  const { data: shipment } = await supabase
    .from("shipments")
    .select(
      "id, barcode, tracking_number, service_code, payment_mode, cod_amount, weight_grams, length_cm, width_cm, height_cm, tariff_amount, provider_ref, booked_at, orders(order_number), customers(name, phone), addresses:shipping_address_id(*)"
    )
    .eq("id", shipmentId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!shipment) {
    throw Object.assign(new Error("Shipment is missing."), { code: "VALIDATION_ERROR" });
  }
  const articleId = articleIdFromShipment(shipment) ?? "";
  if (!articleId || !shipment.booked_at) {
    throw Object.assign(new Error("Book the shipment with India Post to download the receipt."), {
      code: "VALIDATION_ERROR",
    });
  }

  const [{ data: connection }, { data: contract }, { data: pickup }, { data: org }, { data: shop }, event] =
    await Promise.all([
      supabase.from("india_post_connections").select("*").eq("organization_id", organizationId).maybeSingle(),
      shipment.service_code
        ? supabase
            .from("india_post_contracts")
            .select("contract_id")
            .eq("organization_id", organizationId)
            .eq("service_code", shipment.service_code)
            .eq("is_active", true)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("pickup_locations")
        .select("*")
        .eq("organization_id", organizationId)
        .order("is_default", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("organizations")
        .select("name, phone, line1, line2, city, state, pincode")
        .eq("id", organizationId)
        .maybeSingle(),
      supabase.from("shopify_stores").select("shop_name").eq("organization_id", organizationId).maybeSingle(),
      latestIndiaPostEvent(supabase, organizationId, articleId),
    ]);

  const address = asRecord(shipment.addresses);
  const customer = asRecord(shipment.customers);
  const order = asRecord(shipment.orders);
  const sender = organizationLabelSender(org, pickup, shop?.shop_name);
  const destPin = text(address?.pincode);

  const eventBookingOffice = withPin(text(event?.booking_office_name), text(event?.booking_pin));
  const eventDeliveryOffice = withPin(text(event?.destination_office_name), text(event?.destination_pincode));
  const offices =
    (!eventBookingOffice || !eventDeliveryOffice) && connection
      ? await resolveOffices(supabase, organizationId, connection, pickup, sender, destPin)
      : { booking: "", delivery: "" };

  const length = Number(shipment.length_cm) || 0;
  const width = Number(shipment.width_cm) || 0;
  const height = Number(shipment.height_cm) || 0;
  const physical = numberOrNull(shipment.weight_grams);
  const volumetric = length && width && height ? indiaPostVolumetricWeightGrams(length, width, height) || null : null;
  const charged = numberOrNull(event?.weight_value) ?? (physical ? Math.max(physical, volumetric ?? physical) : null);
  const paymentMode = text(shipment.payment_mode).toUpperCase();

  return {
    articleId,
    service: indiaPostServiceLabel(text(event?.article_type) || text(shipment.service_code)),
    bookingRefId: text(event?.booking_ref_id) || text(shipment.provider_ref),
    invoiceNo: text(event?.invoice_no),
    bookingDate: event?.booking_date
      ? `${text(event.booking_date)} ${text(event.booking_time)}`.trim()
      : istDateTime(shipment.booked_at),
    bookingOffice: eventBookingOffice || offices.booking,
    destinationOffice: eventDeliveryOffice || offices.delivery,
    customerId: text(event?.bulk_customer_id) || text(connection?.bulk_customer_id),
    contractId: text(event?.contract_number) || text(contract?.contract_id) || text(connection?.contract_id),
    orderNumber: text(order?.order_number),
    paymentMode,
    physicalWeightGrams: physical,
    volumetricWeightGrams: volumetric,
    chargedWeightGrams: charged,
    dimensions: length && width && height ? `${length} x ${width} x ${height} cm` : "",
    tariff: numberOrNull(event?.tariff) ?? numberOrNull(shipment.tariff_amount),
    codAmount: paymentMode === "COD" ? numberOrNull(event?.cod_amount) ?? (Number(shipment.cod_amount) || 0) : 0,
    sender: {
      name: text(sender.name),
      phone: phone10(sender.phone),
      lines: addressLines(sender),
    },
    receiver: {
      name: text(address?.name) || text(customer?.name),
      phone: phone10(address?.phone) || phone10(customer?.phone),
      lines: addressLines(address ?? {}),
    },
  };
}

function money(value: number) {
  return `Rs ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function wrap(font: PDFFont, value: string, size: number, maxWidth: number) {
  const lines: string[] = [];
  let current = "";
  const pushWord = (word: string) => {
    let chunk = "";
    for (const char of word) {
      if (font.widthOfTextAtSize(chunk + char, size) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    return chunk;
  };
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = font.widthOfTextAtSize(word, size) <= maxWidth ? word : pushWord(word);
    }
  }
  if (current) lines.push(current);
  return lines;
}

function encodable<T>(value: T, supported: Set<number>): T {
  if (typeof value === "string") {
    return [...value].filter((char) => supported.has(char.codePointAt(0) ?? 0)).join("").trim() as T;
  }
  if (Array.isArray(value)) return value.map((item) => encodable(item, supported)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodable(item, supported)])) as T;
  }
  return value;
}

export async function renderReceiptPdf(input: ReceiptData) {
  const document = await PDFDocument.create();
  const page: PDFPage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  // Standard Helvetica is WinAnsi-only; drawText throws on other scripts (e.g. Devanagari addresses).
  const data = encodable(input, new Set(regular.getCharacterSet()));
  document.setTitle(`India Post receipt ${data.articleId}`);
  const ink = rgb(0.07, 0.07, 0.09);
  const muted = rgb(0.38, 0.4, 0.45);
  const line = rgb(0.85, 0.86, 0.88);
  const brand = rgb(0.8, 0.07, 0.15);
  const contentWidth = PAGE_WIDTH - MARGIN * 2;
  const colWidth = contentWidth / 2;
  const divider = (at: number) =>
    page.drawLine({ start: { x: MARGIN, y: at }, end: { x: PAGE_WIDTH - MARGIN, y: at }, thickness: 0.6, color: line });

  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 6, width: PAGE_WIDTH, height: 6, color: brand });
  let y = PAGE_HEIGHT - 34;
  page.drawText("INDIA POST", { x: MARGIN, y, size: 14, font: bold, color: brand });
  const title = "BOOKING RECEIPT";
  page.drawText(title, { x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(title, 11), y: y + 2, size: 11, font: bold, color: ink });
  y -= 14;
  page.drawText(data.service, { x: MARGIN, y, size: 8, font: regular, color: muted });

  y -= 22;
  page.drawText("Article No", { x: MARGIN, y, size: 7, font: regular, color: muted });
  page.drawText(data.articleId, { x: MARGIN, y: y - 15, size: 14, font: bold, color: ink });
  drawBarcode(page, data.articleId, PAGE_WIDTH - MARGIN - 170, y - 20, 170, 28);
  y -= 34;
  divider(y);
  y -= 14;

  const meta = (
    [
      ["Booking Ref ID", data.bookingRefId, true],
      ["Invoice No", data.invoiceNo, false],
      ["Booked On", data.bookingDate, false],
      ["Order No", data.orderNumber, false],
      ["Booking Office", data.bookingOffice, false],
      ["Delivery Office", data.destinationOffice, false],
      ["Customer ID", data.customerId, false],
      ["Contract No", data.contractId, false],
    ] as Array<[string, string, boolean]>
  ).filter(([, value]) => value);
  let index = 0;
  while (index < meta.length) {
    const [label, value, fullWidth] = meta[index];
    if (fullWidth) {
      page.drawText(label, { x: MARGIN, y, size: 7, font: regular, color: muted });
      let cursor = y - 11;
      for (const part of wrap(bold, value, 9, contentWidth)) {
        page.drawText(part, { x: MARGIN, y: cursor, size: 9, font: bold, color: ink });
        cursor -= 11;
      }
      y = cursor - 4;
      index += 1;
      continue;
    }
    let rowBottom = y;
    for (let col = 0; col < 2 && index < meta.length && !meta[index][2]; col += 1, index += 1) {
      const [cellLabel, cellValue] = meta[index];
      const x = MARGIN + col * colWidth;
      page.drawText(cellLabel, { x, y, size: 7, font: regular, color: muted });
      let cursor = y - 11;
      for (const part of wrap(bold, cellValue, 9, colWidth - 8)) {
        page.drawText(part, { x, y: cursor, size: 9, font: bold, color: ink });
        cursor -= 11;
      }
      rowBottom = Math.min(rowBottom, cursor);
    }
    y = rowBottom - 4;
  }

  divider(y);
  y -= 14;

  const drawParty = (heading: string, party: ReceiptParty, x: number, top: number) => {
    page.drawText(heading, { x, y: top, size: 7, font: bold, color: brand });
    let cursor = top - 12;
    const entries: Array<[string, PDFFont]> = [
      [party.name, bold],
      ...party.lines.map((value) => [value, regular] as [string, PDFFont]),
      [party.phone ? `Ph ${party.phone}` : "", regular],
    ];
    for (const [value, font] of entries) {
      if (!value) continue;
      for (const part of wrap(font, value, 8, colWidth - 10)) {
        page.drawText(part, { x, y: cursor, size: 8, font, color: ink });
        cursor -= 10;
      }
    }
    return cursor;
  };
  const senderBottom = drawParty("FROM", data.sender, MARGIN, y);
  const receiverBottom = drawParty("TO", data.receiver, MARGIN + colWidth, y);
  y = Math.min(senderBottom, receiverBottom) - 6;
  divider(y);
  y -= 16;

  const grams = (value: number | null) => (value ? `${value.toLocaleString("en-IN")} g` : "");
  const rows = (
    [
      ["Physical weight", grams(data.physicalWeightGrams)],
      ["Volumetric weight", grams(data.volumetricWeightGrams)],
      ["Charged weight", grams(data.chargedWeightGrams)],
      ["Dimensions (L x B x H)", data.dimensions],
      ["Payment", data.paymentMode],
      ["COD amount", data.codAmount ? money(data.codAmount) : ""],
    ] as Array<[string, string]>
  ).filter(([, value]) => value);
  for (const [label, value] of rows) {
    const font = label === "Charged weight" ? bold : regular;
    page.drawText(label, { x: MARGIN, y, size: 9, font, color: label === "Charged weight" ? ink : muted });
    page.drawText(value, { x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(value, 9), y, size: 9, font, color: ink });
    y -= 15;
  }

  y -= 4;
  page.drawRectangle({ x: MARGIN, y: y - 8, width: contentWidth, height: 24, color: rgb(0.97, 0.97, 0.98), borderColor: line, borderWidth: 0.6 });
  page.drawText("Postage (tariff)", { x: MARGIN + 8, y, size: 10, font: bold, color: ink });
  const tariff = data.tariff != null ? money(data.tariff) : "Pending";
  page.drawText(tariff, { x: PAGE_WIDTH - MARGIN - 8 - bold.widthOfTextAtSize(tariff, 10), y, size: 10, font: bold, color: ink });

  page.drawText("Booking details as reported by India Post (CEPT). Not a tax invoice.", {
    x: MARGIN,
    y: 30,
    size: 7,
    font: regular,
    color: muted,
  });
  page.drawText("Generated by PostBus", { x: MARGIN, y: 20, size: 7, font: regular, color: muted });

  return Buffer.from(await document.save());
}

export async function fetchReceiptPdf(supabase: SupabaseClient, organizationId: string, shipmentId: string) {
  const data = await loadReceiptData(supabase, organizationId, shipmentId);
  return { pdf: await renderReceiptPdf(data), articleId: data.articleId };
}
