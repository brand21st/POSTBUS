import { clampRect } from "@/modules/labels/collision";
import { addressLineTexts, helveticaTextWidth, SAMPLE_SHIP_PARTS, wrapAddressRuns, type AddressParts } from "@/modules/labels/address-layout";

export const LABEL_GENERATED_FROM = "Label Generated From www.postbus.in";
export const LABEL_GENERATED_FROM_SIZE = 6;

export type CustomLabelBlock = {
  id: string;
  label: string;
  group: "Layout" | "Header" | "Content";
};

export const CUSTOM_LABEL_BLOCKS: CustomLabelBlock[] = [
  { id: "labelBorder", label: "Label border", group: "Layout" },
  { id: "merchantLogo", label: "Store logo", group: "Header" },
  { id: "customerId", label: "Customer ID", group: "Header" },
  { id: "articleType", label: "Article type", group: "Header" },
  { id: "serviceContractId", label: "Service contract ID", group: "Header" },
  { id: "indiaPostBarcode", label: "India Post Barcode / Waybill", group: "Header" },
  { id: "fromAddress", label: "From / Seller address", group: "Content" },
  { id: "shipTo", label: "Ship to address", group: "Content" },
  { id: "orderIdDate", label: "Order ID & date", group: "Content" },
  { id: "parcelSize", label: "Box size, weight & volumetric", group: "Content" },
  { id: "codAmount", label: "COD Amount", group: "Content" },
  { id: "prepaid", label: "Prepaid", group: "Content" },
  { id: "products", label: "Product list", group: "Content" },
  { id: "customText", label: "Custom text 1", group: "Content" },
];

export const CUSTOM_TEXT_LIMIT = 12;

export function isCustomTextId(id: string) {
  return id === "customText" || /^customText([2-9]|1[0-2])$/.test(id);
}

export function customTextIndex(id: string) {
  if (id === "customText") return 1;
  const value = Number(id.replace("customText", ""));
  return Number.isFinite(value) ? value : 99;
}

export function customTextLabel(id: string) {
  return `Custom text ${customTextIndex(id)}`;
}

export function customTextIds(elements: Record<string, unknown>) {
  return Object.keys(elements)
    .filter(isCustomTextId)
    .sort((a, b) => customTextIndex(a) - customTextIndex(b));
}

export function nextCustomTextId(elements: Record<string, unknown>) {
  const used = new Set(customTextIds(elements));
  if (!used.has("customText")) return "customText";
  for (let index = 2; index <= CUSTOM_TEXT_LIMIT; index += 1) {
    const id = `customText${index}`;
    if (!used.has(id)) return id;
  }
  return null;
}

export function editorLabelBlocks(elements: Record<string, unknown>): CustomLabelBlock[] {
  const extras = customTextIds(elements)
    .filter((id) => id !== "customText")
    .map((id) => ({ id, label: customTextLabel(id), group: "Content" as const }));
  return [...CUSTOM_LABEL_BLOCKS, ...extras];
}

export function createCustomTextElement(page: { widthPt: number; heightPt: number }, index: number) {
  const height = 28;
  const y = Math.max(12, page.heightPt - 22 - height - index * (height + 6));
  return {
    visible: true,
    font: "Helvetica",
    fontSize: 9,
    fontWeight: "normal" as const,
    align: "left" as const,
    content: "",
    autoHeight: true,
    ...clampRect({ x: 16, y, width: Math.max(24, page.widthPt - 32), height }, page.widthPt, page.heightPt),
  };
}

export function customTextBlockHeight(
  element: { width: number; fontSize?: number; lineGap?: number; gap?: number; fontWeight?: string; content?: string },
  text = element.content ?? ""
) {
  const gap = Math.max(0, element.gap ?? 0);
  const inner = Math.max(8, element.width - gap * 2);
  const size = element.fontSize ?? 9;
  const lineHeight = size + (element.lineGap ?? 2);
  const bold = element.fontWeight === "bold";
  const source = text.trim() ? text.split("\n") : ["Custom text"];
  const lines = source.flatMap((line) => wrapPlainText(line || " ", inner, size, bold));
  return gap * 2 + Math.max(1, lines.length) * lineHeight;
}

export type CustomLabelPreview = {
  shipmentId: string | null;
  articleId: string;
  articleType: string;
  contractId: string;
  customerId: string;
  paymentMode: string;
  orderNumber: string;
  orderDate: string;
  fromLines: string[];
  shipLines: string[];
  shipParts?: AddressParts;
  fromParts?: AddressParts;
  items: ProductLine[];
  total: number;
  codAmount: number;
  weightGrams?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  logoUrl?: string | null;
};

export type ProductColumnId = "name" | "sku" | "description" | "qty" | "weight" | "price" | "note";

export type ProductColumnFlags = {
  showName?: boolean;
  showSku?: boolean;
  showDescription?: boolean;
  showQuantity?: boolean;
  showWeight?: boolean;
  showPrice?: boolean;
  showCustomNote?: boolean;
};

export const PRODUCT_COLUMNS: Array<{
  id: ProductColumnId;
  label: string;
  flag: keyof ProductColumnFlags;
  defaultOn: boolean;
}> = [
  { id: "name", label: "Product name", flag: "showName", defaultOn: true },
  { id: "sku", label: "SKU", flag: "showSku", defaultOn: false },
  { id: "description", label: "Description", flag: "showDescription", defaultOn: false },
  { id: "qty", label: "Qty", flag: "showQuantity", defaultOn: true },
  { id: "weight", label: "Weight (g)", flag: "showWeight", defaultOn: true },
  { id: "price", label: "Price", flag: "showPrice", defaultOn: true },
  { id: "note", label: "Custom note", flag: "showCustomNote", defaultOn: false },
];

export type ProductLine = {
  title: string;
  sku?: string | null;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  weightGrams?: number | null;
  note?: string | null;
};

export type ProductTableRow = { cells: string[]; bold?: boolean };

export type ProductTable = {
  columns: Array<{ id: ProductColumnId; label: string }>;
  rows: ProductTableRow[];
};

export const PRODUCT_SAMPLE_LINES: ProductLine[] = [
  { title: "Demo product 1", quantity: 2, unitPrice: 599, weightGrams: 180 },
  { title: "Demo product 2", quantity: 1, unitPrice: 149, weightGrams: 100 },
  { title: "Demo product 3", quantity: 1, unitPrice: 299, weightGrams: 220 },
];

export function productColumnVisible(flags: ProductColumnFlags | undefined, column: (typeof PRODUCT_COLUMNS)[number]) {
  const value = flags?.[column.flag];
  return value === undefined ? column.defaultOn : value;
}

export function productMoney(value: number) {
  const amount = Number.isFinite(value) ? value : 0;
  return `Rs. ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function productWeightLabel(weightGrams?: number | null, quantity = 1) {
  const grams = Number(weightGrams);
  if (!Number.isFinite(grams) || grams <= 0) return "";
  return `${Math.round(grams * (quantity || 1))}g`;
}

export const PRODUCT_COLUMN_FLEX: Record<ProductColumnId, number> = {
  name: 4,
  sku: 1.6,
  description: 2.2,
  qty: 0.8,
  weight: 1.4,
  price: 1.6,
  note: 1.8,
};

export function wrapProductCell(text: string, maxWidth: number, fontSize: number, bold = false) {
  const lines = wrapAddressRuns([{ text, bold, italic: false }], Math.max(4, maxWidth), (value, run) =>
    helveticaTextWidth(value, fontSize, run.bold)
  );
  return lines.map((runs) => runs.map((run) => run.text).join("")).filter((line) => line.length > 0);
}

export function productColumnWidths(columns: Array<{ id: ProductColumnId }>, innerWidth: number) {
  const flexSum = columns.reduce((sum, column) => sum + PRODUCT_COLUMN_FLEX[column.id], 0) || 1;
  return columns.map((column) => (innerWidth * PRODUCT_COLUMN_FLEX[column.id]) / flexSum);
}

export function productTableHeight(
  element: {
    width: number;
    fontSize?: number;
    lineGap?: number;
    gap?: number;
    showName?: boolean;
    showSku?: boolean;
    showDescription?: boolean;
    showQuantity?: boolean;
    showWeight?: boolean;
    showPrice?: boolean;
    showCustomNote?: boolean;
  },
  items: ProductLine[],
  options?: { total?: number; includeTotal?: boolean }
) {
  const table = productTable(items, element, options);
  const gap = Math.max(0, element.gap ?? 0);
  const inner = Math.max(8, element.width - gap * 2);
  const size = element.fontSize ?? 9;
  const lineHeight = size + (element.lineGap ?? 2);
  const pad = 4;
  const widths = productColumnWidths(table.columns, inner);
  const rowHeight = (cells: string[], bold = false) => {
    const lines = Math.max(
      1,
      ...cells.map((cell, index) => wrapProductCell(cell, Math.max(4, (widths[index] ?? inner) - 6), size, bold).length)
    );
    return lines * lineHeight + pad;
  };
  const header = rowHeight(table.columns.map((column) => column.label), true);
  const body = table.rows.reduce((sum, row) => sum + rowHeight(row.cells, Boolean(row.bold)), 0);
  return gap * 2 + header + body;
}

export function productTable(
  items: ProductLine[],
  flags: ProductColumnFlags | undefined,
  options?: { total?: number; includeTotal?: boolean }
): ProductTable {
  const columns = PRODUCT_COLUMNS.filter((column) => productColumnVisible(flags, column)).map((column) => ({
    id: column.id,
    label: column.label,
  }));
  const cell = (item: ProductLine, id: ProductColumnId) => {
    if (id === "name") return item.title;
    if (id === "sku") return item.sku?.trim() || "";
    if (id === "description") return item.description?.trim() || "";
    if (id === "qty") return String(item.quantity || 1);
    if (id === "weight") return productWeightLabel(item.weightGrams, item.quantity);
    if (id === "price") return productMoney(item.unitPrice * (item.quantity || 1));
    return item.note?.trim() || "";
  };
  const rows: ProductTableRow[] = items.length
    ? items.map((item) => ({ cells: columns.map((column) => cell(item, column.id)) }))
    : [{ cells: columns.map((column, index) => (index === 0 ? "No products" : "")) }];
  const showPrice = columns.some((column) => column.id === "price");
  if (options?.includeTotal && showPrice) {
    const summed = items.reduce((sum, item) => sum + item.unitPrice * (item.quantity || 1), 0);
    const amount = productMoney((options.total ?? 0) > 0 ? options.total! : summed);
    rows.push({
      bold: true,
      cells: columns.map((column) => {
        if (column.id === "price") return amount;
        if (column.id === "name") return "Total";
        return "";
      }),
    });
    if (!columns.some((column) => column.id === "name")) {
      const first = rows[rows.length - 1].cells.findIndex((value) => value === "");
      if (first >= 0 && columns[first]?.id !== "price") rows[rows.length - 1].cells[first] = "Total";
    }
  }
  return { columns, rows };
}

function productTableLines(
  items: ProductLine[],
  flags: ProductColumnFlags | undefined,
  options?: { total?: number; includeTotal?: boolean }
) {
  const table = productTable(items, flags, options);
  return [table.columns.map((column) => column.label).join("  "), ...table.rows.map((row) => row.cells.join("  "))];
}

export type ParcelSizeInput = {
  weightGrams?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
};

function formatCm(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

export const PARCEL_SIZE_SAMPLE: ParcelSizeInput = {
  lengthCm: 30,
  widthCm: 20,
  heightCm: 4,
  weightGrams: 500,
};

export function parcelSizeLines(input?: ParcelSizeInput | null, loaded = false) {
  const length = Number(input?.lengthCm);
  const width = Number(input?.widthCm);
  const height = Number(input?.heightCm);
  const weight = Number(input?.weightGrams);
  const hasBox = length > 0 && width > 0 && height > 0;
  const lines: string[] = [];
  if (hasBox) lines.push(`Box: ${formatCm(length)} × ${formatCm(width)} × ${formatCm(height)} cm`);
  if (Number.isFinite(weight) && weight > 0) lines.push(`Weight: ${Math.round(weight)} g`);
  else if (loaded) lines.push("Weight not available");
  if (hasBox) lines.push(`Volumetric: ${Math.ceil((length * width * height) / 5)} g`);
  return lines;
}

export function serviceContractLine(contractId?: string | null) {
  const id = contractId?.trim() ?? "";
  return id ? `Contract ID: ${id}` : "";
}

export function customerIdLine(customerId?: string | null) {
  const id = customerId?.trim() ?? "";
  return id ? `Customer ID: ${id}` : "";
}

export function articleContractLine(articleType?: string | null, contractId?: string | null) {
  const article = articleType?.trim() ?? "";
  const contract = contractId?.trim() ?? "";
  if (article && contract) return `${article} : ${contract}`;
  return article;
}

export function isCodPayment(mode?: string | null) {
  const value = (mode ?? "").toUpperCase();
  return value === "COD" || value.includes("CASH ON") || value.includes("CASH_ON");
}

const SMALL_NUMBERS = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS_NUMBERS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowThousand(value: number) {
  const n = Math.floor(Math.abs(value));
  if (n <= 0) return "";
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundred) parts.push(`${SMALL_NUMBERS[hundred]} Hundred`);
  if (rest) {
    if (rest < 20) parts.push(SMALL_NUMBERS[rest] ?? "");
    else {
      const ten = TENS_NUMBERS[Math.floor(rest / 10)] ?? "";
      const one = SMALL_NUMBERS[rest % 10] ?? "";
      parts.push([ten, one].filter(Boolean).join(" "));
    }
  }
  return parts.join(" ");
}

export function indianNumberWords(value: number) {
  const n = Math.floor(Math.abs(Number.isFinite(value) ? value : 0));
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1_000);
  const rest = n % 1_000;
  const parts: string[] = [];
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

export function amountInIndianRupees(value: number) {
  const amount = Number.isFinite(value) ? Math.max(0, value) : 0;
  const paiseTotal = Math.round(amount * 100);
  const rupees = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  const rupeeWords = indianNumberWords(rupees);
  if (paise) return `Rupees ${rupeeWords} and ${indianNumberWords(paise)} Paise Only`;
  return `Rupees ${rupeeWords} Only`;
}

export function formatCodRupees(value: number) {
  const amount = Number.isFinite(value) ? value : 0;
  return `Rs. ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function codAmountLines(amount: number) {
  return ["COD", `Amount: ${formatCodRupees(amount)}`, amountInIndianRupees(amount)];
}

export function wrapPlainText(text: string, maxWidth: number, fontSize: number, bold = false) {
  return wrapAddressRuns([{ text, bold, italic: false }], Math.max(4, maxWidth), (value, run) =>
    helveticaTextWidth(value, fontSize, run.bold)
  ).map((runs) => runs.map((run) => run.text).join(""));
}

export function codBlockHeight(
  element: { width: number; fontSize?: number; lineGap?: number; gap?: number; fontWeight?: string },
  amount: number
) {
  const gap = Math.max(0, element.gap ?? 0);
  const inner = Math.max(8, element.width - gap * 2);
  const size = element.fontSize ?? 10;
  const lineHeight = size + (element.lineGap ?? 2);
  const bold = element.fontWeight === "bold";
  const lines = codAmountLines(amount).flatMap((line) => wrapPlainText(line, inner, size, bold));
  return gap * 2 + Math.max(1, lines.length) * lineHeight;
}

export function bookedBlockText(
  id: string,
  preview: CustomLabelPreview,
  element?: { content?: string }
): string {
  if (isCustomTextId(id)) return element?.content?.trim() || "";
  if (id === "customerId") return customerIdLine(preview.customerId);
  if (id === "articleType") return articleContractLine(preview.articleType, preview.contractId);
  if (id === "serviceContractId") return serviceContractLine(preview.contractId);
  if (id === "indiaPostBarcode") return preview.articleId.trim() || "India Post tracking number not available";
  if (id === "orderIdDate") {
    const order = preview.orderNumber ? `Order ID: ${preview.orderNumber}` : "";
    const date = preview.orderDate ? `Date: ${preview.orderDate}` : "";
    return [order, date].filter(Boolean).join(", ");
  }
  if (id === "parcelSize") return parcelSizeLines(preview, true).join("\n");
  if (id === "codAmount") return codAmountLines(preview.codAmount).join("\n");
  if (id === "prepaid") return "PRE PAID";
  if (id === "fromAddress") {
    if (preview.fromParts) {
      return addressLineTexts({ headingText: "From/ Return Address" }, preview.fromParts).join("\n");
    }
    return ["From/ Return Address", ...preview.fromLines].filter(Boolean).join("\n");
  }
  if (id === "shipTo") {
    return addressLineTexts({ headingText: "Ship To:" }, preview.shipParts ?? SAMPLE_SHIP_PARTS).join("\n");
  }
  if (id === "products") return productTableLines(preview.items, undefined, { includeTotal: true, total: preview.total }).join("\n");
  return "";
}

export function blockPreviewLines(
  id: string,
  preview: CustomLabelPreview | null,
  element?: { content?: string }
): string[] {
  if (isCustomTextId(id)) {
    const text = element?.content?.trim();
    return text ? text.split("\n") : preview ? [] : ["Custom text"];
  }
  if (id === "indiaPostBarcode") {
    if (!preview) return [];
    return [bookedBlockText(id, preview)];
  }
  if (!preview) {
    if (id === "shipTo") return addressLineTexts(undefined, SAMPLE_SHIP_PARTS);
    if (id === "fromAddress") return ["From/ Return Address", "Seller address"];
    if (id === "customerId") return ["Customer ID"];
    if (id === "articleType") return ["Speed Post parcel"];
    if (id === "serviceContractId") return ["Contract ID"];
    if (id === "orderIdDate") return ["Order ID, Date"];
    if (id === "parcelSize") return parcelSizeLines(PARCEL_SIZE_SAMPLE);
    if (id === "codAmount") return codAmountLines(2597);
    if (id === "prepaid") return ["PRE PAID"];
    if (id === "products") return productTableLines(PRODUCT_SAMPLE_LINES, undefined, { includeTotal: true });
    if (id === "merchantLogo") return ["Logo"];
    return [];
  }
  const text = bookedBlockText(id, preview, element);
  return text ? text.split("\n") : [];
}
