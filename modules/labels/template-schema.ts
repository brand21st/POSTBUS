import { z } from "zod";
import { addressContentHeight, defaultAddressLayout, type AddressParts } from "@/modules/labels/address-layout";
import { clampRect } from "@/modules/labels/collision";
import { PAGE_PRESETS, officialDrawRect, pagePreset, type PagePreset, type PaperSizeId } from "@/modules/labels/page-presets";

export const MERCHANT_ELEMENT_IDS = [
  "merchantLogo",
  "receiverName",
  "receiverAddress",
  "receiverPhone",
  "senderName",
  "senderAddress",
  "senderPhone",
  "storeName",
  "storePhone",
  "storeWebsite",
  "orderNumber",
  "shopifyOrderNumber",
  "products",
  "subtotal",
  "shipping",
  "discount",
  "total",
  "codAmount",
  "paymentMethod",
  "customerNote",
  "customText",
  "promotionalMessage",
  "returnAddress",
  "returnPolicy",
  "customerSupport",
  "labelBorder",
  "indiaPostBarcode",
  "fromAddress",
  "shipTo",
  "articleType",
  "customerId",
  "serviceContractId",
  "orderIdDate",
  "parcelSize",
  "prepaid",
] as const;

export const INDEPENDENT_BLOCK_IDS = [
  "labelBorder",
  "indiaPostBarcode",
  "fromAddress",
  "shipTo",
  "articleType",
  "customerId",
  "serviceContractId",
  "orderIdDate",
  "parcelSize",
  "prepaid",
] as const;

export type MerchantElementId = (typeof MERCHANT_ELEMENT_IDS)[number];

export const MERCHANT_OVERLAY_IDS = ["merchantLogo", "orderNumber", "products", "total"] as const;
export type MerchantOverlayId = (typeof MERCHANT_OVERLAY_IDS)[number];

const elementSchema = z.object({
  visible: z.boolean().default(true),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  font: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.enum(["normal", "bold"]).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  lineGap: z.number().optional(),
  gap: z.number().optional(),
  content: z.string().optional(),
  showName: z.boolean().optional(),
  showSku: z.boolean().optional(),
  showDescription: z.boolean().optional(),
  showQuantity: z.boolean().optional(),
  showWeight: z.boolean().optional(),
  showPrice: z.boolean().optional(),
  showCustomNote: z.boolean().optional(),
  showArticleText: z.boolean().optional(),
  autoHeight: z.boolean().optional(),
  borderWidth: z.number().optional(),
  hLineWidth: z.number().optional(),
  hLineGapMm: z.number().optional(),
  hLines: z
    .array(
      z.object({
        visible: z.boolean(),
        yMm: z.number(),
      })
    )
    .max(5)
    .optional(),
  addressLayout: z
    .object({
      showHeading: z.boolean().optional(),
      headingText: z.string().optional(),
      headingBold: z.boolean().optional(),
      headingItalic: z.boolean().optional(),
      lineGapMm: z.number().optional(),
      separatorThicknessMm: z.number().optional(),
      sameLineSeparator: z.string().optional(),
      fields: z
        .array(
          z.object({
            id: z.enum([
              "name",
              "street",
              "city",
              "district",
              "state",
              "pincode",
              "country",
              "mobile",
              "altMobile",
              "email",
            ]),
            visible: z.boolean(),
            sameLineAsNext: z.boolean().optional(),
            bold: z.boolean().optional(),
            italic: z.boolean().optional(),
          })
        )
        .optional(),
    })
    .optional(),
});

const pageSchema = z.object({
  paperSize: z.enum(["A6", "4x6", "A5", "A4", "custom"]),
  widthPt: z.number(),
  heightPt: z.number(),
  widthMm: z.number().optional(),
  heightMm: z.number().optional(),
});

const namedTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  isDefault: z.boolean(),
  page: pageSchema,
  elements: z.record(z.string(), elementSchema),
});

export const labelTemplateSchema = z.object({
  templateVersion: z.number().int().min(1),
  page: pageSchema,
  elements: z.record(z.string(), elementSchema),
  library: z.array(namedTemplateSchema).optional(),
});

export type LabelTemplate = z.infer<typeof labelTemplateSchema>;
export type TemplateElement = z.infer<typeof elementSchema>;
export type NamedLabelTemplate = z.infer<typeof namedTemplateSchema>;

function mmToPt(mm: number) {
  return (mm * 72) / 25.4;
}

function ptToMm(pt: number) {
  return (pt * 25.4) / 72;
}

export function elementBoxMm(element: Pick<TemplateElement, "x" | "y" | "width" | "height">, pageHeightPt: number) {
  return {
    xMm: ptToMm(element.x),
    yMm: ptToMm(pageHeightPt - element.y - element.height),
    widthMm: ptToMm(element.width),
    heightMm: ptToMm(element.height),
  };
}

export function fullPageBorderRect(page: { widthPt: number; heightPt: number }) {
  return clampRect({ x: 0, y: 0, width: page.widthPt, height: page.heightPt }, page.widthPt, page.heightPt);
}

export function defaultHLines(pageHeightPt: number) {
  const heightMm = ptToMm(pageHeightPt);
  return [1, 2, 3, 4, 5].map((index) => ({
    visible: true,
    yMm: Math.round(((heightMm * index) / 6) * 10) / 10,
  }));
}

export function normalizeHLines(
  lines: Array<{ visible?: boolean; yMm?: number }> | undefined,
  pageHeightPt: number
) {
  const heightMm = ptToMm(pageHeightPt);
  return defaultHLines(pageHeightPt).map((fallback, index) => {
    const saved = lines?.[index];
    const yMm = Number.isFinite(saved?.yMm) ? Number(saved?.yMm) : fallback.yMm;
    return {
      visible: saved ? saved.visible !== false : fallback.visible,
      yMm: Math.min(heightMm, Math.max(0, yMm)),
    };
  });
}

export function horizontalLineBars(
  border: Pick<TemplateElement, "x" | "width" | "borderWidth" | "hLineWidth" | "hLineGapMm" | "hLines">,
  pageHeightPt: number
) {
  const stroke = Math.min(12, Math.max(0.25, border.hLineWidth ?? border.borderWidth ?? 1));
  const gap = Math.max(0, mmToPt(border.hLineGapMm ?? 0));
  return normalizeHLines(border.hLines, pageHeightPt)
    .filter((line) => line.visible)
    .map((line) => ({
      x: border.x + gap,
      y: Math.max(0, pageHeightPt - mmToPt(line.yMm) - stroke),
      width: Math.max(0, border.width - gap * 2),
      height: stroke,
    }));
}

export function fitLabelBorderToPage(
  elements: LabelTemplate["elements"],
  page: { widthPt: number; heightPt: number }
): LabelTemplate["elements"] {
  const current = elements.labelBorder;
  if (!current) return elements;
  return {
    ...elements,
    labelBorder: {
      ...current,
      ...fullPageBorderRect(page),
      hLineGapMm: current.hLineGapMm ?? 0,
      hLineWidth: current.hLineWidth ?? current.borderWidth ?? 1,
      hLines: normalizeHLines(current.hLines, page.heightPt),
    },
  };
}

export function growAutoHeightBox<T extends { x: number; y: number; width: number; height: number; autoHeight?: boolean }>(
  element: T,
  page: { widthPt: number; heightPt: number },
  needed: number
): T {
  if (element.autoHeight === false) return element;
  const height = Math.max(element.height, needed, 12);
  const top = element.y + element.height;
  return {
    ...element,
    ...clampRect({ x: element.x, y: top - height, width: element.width, height }, page.widthPt, page.heightPt),
    autoHeight: true as const,
  };
}

export function fitAddressBox(
  element: TemplateElement,
  page: { widthPt: number; heightPt: number },
  parts: AddressParts,
  headingText = "Ship To:"
): TemplateElement {
  return {
    ...element,
    ...growAutoHeightBox(element, page, addressContentHeight(element, parts, headingText)),
  };
}

export function elementBoxFromMm(
  current: Pick<TemplateElement, "x" | "y" | "width" | "height">,
  page: { widthPt: number; heightPt: number },
  mm: { xMm?: number; yMm?: number; widthMm?: number; heightMm?: number }
) {
  const width = mm.widthMm != null ? mmToPt(mm.widthMm) : current.width;
  const height = mm.heightMm != null ? mmToPt(mm.heightMm) : current.height;
  const x = mm.xMm != null ? mmToPt(mm.xMm) : current.x;
  const yFromTop = mm.yMm != null ? mmToPt(mm.yMm) : page.heightPt - current.y - current.height;
  return clampRect({ x, y: page.heightPt - yFromTop - height, width, height }, page.widthPt, page.heightPt);
}

function hiddenBlock(
  page: LabelTemplate["page"],
  rect?: Partial<TemplateElement>
): TemplateElement {
  return {
    x: 16,
    y: 16,
    width: Math.max(24, Math.min(160, page.widthPt - 32)),
    height: 48,
    font: "Helvetica",
    fontSize: 9,
    fontWeight: "normal",
    align: "left",
    showArticleText: true,
    ...rect,
    visible: false,
  };
}

function serviceContractPlacement(
  elements: LabelTemplate["elements"],
  page: LabelTemplate["page"]
): TemplateElement {
  const article = elements.articleType;
  if (!article?.visible) return hiddenBlock(page);
  return {
    ...hiddenBlock(page, {
      x: article.x,
      y: article.y - 28,
      width: article.width,
      height: 24,
      fontSize: 10,
    }),
    visible: true,
  };
}

function parcelSizePlacement(
  elements: LabelTemplate["elements"],
  page: LabelTemplate["page"]
): TemplateElement {
  const order = elements.orderIdDate;
  if (!order?.visible) return hiddenBlock(page);
  return {
    ...hiddenBlock(page, {
      x: order.x,
      y: order.y - 40,
      width: order.width,
      height: 36,
      fontSize: 10,
    }),
    visible: true,
  };
}

function withIndependentBlocks(
  elements: LabelTemplate["elements"],
  page: LabelTemplate["page"]
): LabelTemplate["elements"] {
  const next = { ...elements };
  for (const id of INDEPENDENT_BLOCK_IDS) {
    if (next[id]) continue;
    if (id === "serviceContractId") next[id] = serviceContractPlacement(next, page);
    else if (id === "customerId") {
      next[id] = {
        ...hiddenBlock(page, { fontSize: 11, fontWeight: "bold" }),
        visible: Boolean(next.indiaPostBarcode?.visible),
      };
    } else if (id === "parcelSize") next[id] = parcelSizePlacement(next, page);
    else if (id === "labelBorder") next[id] = { ...hiddenBlock(page, fullPageBorderRect(page)), visible: false };
    else next[id] = hiddenBlock(page);
  }
  for (const id of ["merchantLogo", "products", "codAmount", "customText"] as const) {
    if (next[id]) continue;
    next[id] = hiddenBlock(page, id === "customText" ? { content: "", autoHeight: true } : undefined);
  }
  return fitLabelBorderToPage(next, page);
}

export function ensureIndependentBlocks(template: LabelTemplate): LabelTemplate {
  return {
    ...template,
    elements: withIndependentBlocks(template.elements, template.page),
    library: template.library?.map((entry) => ({
      ...entry,
      elements: withIndependentBlocks(entry.elements, entry.page),
    })),
  };
}

export function labelPageSize(page: LabelTemplate["page"]) {
  return { widthPt: page.widthPt, heightPt: page.heightPt };
}

export function selectLabelTemplate(template: LabelTemplate, templateId?: string | null): LabelTemplate {
  if (!templateId || !template.library?.length) return template;
  const found = template.library.find((item) => item.id === templateId);
  if (!found) return template;
  return { ...template, page: found.page, elements: found.elements };
}

export function withEditorDraft(
  stored: LabelTemplate,
  templateId: string,
  draft: { name: string; page: LabelTemplate["page"]; elements: LabelTemplate["elements"] }
): LabelTemplate {
  const library = stored.library?.length ? [...stored.library] : null;
  const nextLibrary = library?.map((item) =>
    item.id === templateId ? { ...item, name: draft.name.trim() || item.name, page: draft.page, elements: draft.elements } : item
  );
  return {
    ...stored,
    templateVersion: Math.max(stored.templateVersion, 5),
    library: nextLibrary ?? stored.library,
    page: draft.page,
    elements: draft.elements,
  };
}

const DEFAULT_VISIBLE: MerchantElementId[] = [
  "merchantLogo",
  "receiverName",
  "receiverAddress",
  "receiverPhone",
  "senderName",
  "senderAddress",
  "senderPhone",
  "orderNumber",
  "products",
  "total",
];

function placeOverlayFields(page: PagePreset, elements: LabelTemplate["elements"]) {
  const official = officialDrawRect(page.widthPt, page.heightPt);
  const extra = official.y;
  const margin = 16;
  const width = Math.max(80, page.widthPt - margin * 2);

  if (extra >= 88) {
    let y = extra - 10;
    const put = (
      id: MerchantOverlayId,
      height: number,
      extraProps?: Partial<TemplateElement>
    ) => {
      y -= height;
      Object.assign(elements[id], {
        x: margin,
        y: Math.max(8, y),
        width,
        height,
        visible: true,
        fontSize: id === "products" ? 8 : id === "merchantLogo" ? 10 : 10,
        fontWeight: id === "orderNumber" || id === "total" ? "bold" : "normal",
        ...extraProps,
      });
      y -= 8;
    };
    put("merchantLogo", 40, { width: 96, height: 40 });
    put("orderNumber", 16);
    const productHeight = Math.min(96, Math.max(36, y - 32));
    put("products", productHeight);
    put("total", 16);
    return elements;
  }

  Object.assign(elements.merchantLogo, { x: 14, y: 268, width: 40, height: 16, visible: true });
  Object.assign(elements.orderNumber, {
    x: 58,
    y: 270,
    width: 224,
    height: 14,
    fontSize: 8,
    fontWeight: "bold",
    visible: true,
  });
  Object.assign(elements.products, {
    x: 14,
    y: 250,
    width: 178,
    height: 16,
    fontSize: 7,
    visible: true,
  });
  Object.assign(elements.total, {
    x: 198,
    y: 250,
    width: 84,
    height: 16,
    fontSize: 8,
    fontWeight: "bold",
    visible: true,
  });
  return elements;
}

function stack(pageHeight: number) {
  let top = pageHeight - 18;
  return (height: number, gap = 6) => {
    top -= height;
    const y = top;
    top -= gap;
    return y;
  };
}

export function defaultLabelTemplate(paperSize: PaperSizeId = "A5"): LabelTemplate {
  const page = pagePreset(paperSize);
  const nextY = stack(page.heightPt);
  const margin = 16;
  const width = page.widthPt - margin * 2;
  const elements: LabelTemplate["elements"] = {};

  const place = (
    id: MerchantElementId,
    height: number,
    extra?: Partial<TemplateElement>
  ) => {
    elements[id] = {
      visible: DEFAULT_VISIBLE.includes(id),
      x: margin,
      y: nextY(height),
      width,
      height,
      font: "Helvetica",
      fontSize: id === "storeName" || id === "receiverName" || id === "senderName" ? 12 : 9,
      fontWeight:
        id === "storeName" ||
        id === "receiverName" ||
        id === "senderName" ||
        id === "total" ||
        id === "codAmount"
          ? "bold"
          : "normal",
      align: "left",
      showName: true,
      showSku: false,
      showQuantity: true,
      showPrice: true,
      ...extra,
    };
  };

  place("merchantLogo", 36, { width: 90, height: 36 });
  place("receiverName", 16);
  place("receiverAddress", 36);
  place("receiverPhone", 12);
  place("senderName", 16);
  place("senderAddress", 36);
  place("senderPhone", 12);
  place("storeName", 16);
  place("storePhone", 12);
  place("storeWebsite", 12);
  place("orderNumber", 14);
  place("shopifyOrderNumber", 12);
  place("products", 72);
  place("subtotal", 12);
  place("shipping", 12);
  place("discount", 12);
  place("total", 14);
  place("codAmount", 14);
  place("paymentMethod", 12);
  place("customerNote", 28);
  place("customText", 24, { content: "", autoHeight: true });
  place("promotionalMessage", 24, { content: "" });
  place("returnAddress", 36);
  place("returnPolicy", 28, { content: "Returns accepted within 7 days in original condition." });
  place("customerSupport", 24, { content: "" });
  placeOverlayFields(page, elements);

  return ensureIndependentBlocks({
    templateVersion: 4,
    page: {
      paperSize: page.id,
      widthPt: page.widthPt,
      heightPt: page.heightPt,
    },
    elements,
  });
}

function placeBand(
  elements: LabelTemplate["elements"],
  page: { widthPt: number; heightPt: number },
  id: string,
  rect: { x: number; y: number; width: number; height: number }
) {
  const current = elements[id];
  if (!current) return;
  elements[id] = { ...current, ...clampRect(rect, page.widthPt, page.heightPt) };
}

export function arrangeIndiaPostBands(
  elements: LabelTemplate["elements"],
  page: { widthPt: number; heightPt: number }
): LabelTemplate["elements"] {
  const next = { ...elements };
  const margin = 8;
  const inner = Math.max(48, page.widthPt - margin * 2);
  const half = Math.max(24, (inner - 8) / 2);
  const right = margin + half + 8;
  const height = page.heightPt;
  const shares = [0.16, 0.08, 0.14, 0.24, 0.18];
  const heights = shares.map((share) => height * share);
  const productHeight = Math.max(12, height - heights.reduce((sum, value) => sum + value, 0));
  let top = height;
  const take = (bandHeight: number) => {
    top -= bandHeight;
    return top;
  };

  const barcodeY = take(heights[0]);
  placeBand(next, page, "merchantLogo", { x: margin, y: barcodeY, width: half, height: heights[0] });
  placeBand(next, page, "indiaPostBarcode", { x: right, y: barcodeY, width: half, height: heights[0] });

  const identityY = take(heights[1]);
  placeBand(next, page, "customerId", { x: margin, y: identityY, width: half, height: heights[1] });
  placeBand(next, page, "articleType", { x: right, y: identityY, width: half, height: heights[1] });

  const bookingHeight = heights[2];
  const bookingY = take(bookingHeight);
  const rowHeight = Math.max(12, bookingHeight / 2);
  placeBand(next, page, "orderIdDate", { x: margin, y: bookingY + rowHeight, width: half, height: rowHeight });
  placeBand(next, page, "parcelSize", { x: margin, y: bookingY, width: half, height: rowHeight });
  placeBand(next, page, "codAmount", { x: right, y: bookingY, width: half, height: bookingHeight });
  placeBand(next, page, "prepaid", { x: right, y: bookingY, width: half, height: bookingHeight });

  const shipY = take(heights[3]);
  placeBand(next, page, "shipTo", { x: margin, y: shipY, width: inner, height: heights[3] });
  const fromY = take(heights[4]);
  placeBand(next, page, "fromAddress", { x: margin, y: fromY, width: inner, height: heights[4] });
  const productsY = take(productHeight);
  placeBand(next, page, "products", { x: margin, y: productsY, width: inner, height: productHeight });

  const border = next.labelBorder;
  if (border) {
    next.labelBorder = {
      ...border,
      ...fullPageBorderRect(page),
      hLineGapMm: border.hLineGapMm ?? 0,
      hLineWidth: border.hLineWidth ?? border.borderWidth ?? 1,
      hLines: [0.16, 0.24, 0.38, 0.62, 0.8].map((share) => ({
        visible: true,
        yMm: Math.round(ptToMm(height * share) * 10) / 10,
      })),
    };
  }
  return fitLabelBorderToPage(next, page);
}

export function indiaPostLabelTemplate(): LabelTemplate {
  const widthMm = 297;
  const heightMm = 210;
  const widthPt = mmToPt(widthMm);
  const heightPt = mmToPt(heightMm);
  const base = defaultLabelTemplate("A4");
  const elements: LabelTemplate["elements"] = {};
  for (const [id, element] of Object.entries(base.elements)) {
    elements[id] = { ...element, visible: false };
  }

  const show = (id: MerchantElementId, extra?: Partial<TemplateElement>) => {
    elements[id] = {
      ...elements[id],
      visible: true,
      font: "Helvetica",
      fontSize: 10,
      fontWeight: "normal",
      align: "left",
      showArticleText: true,
      ...extra,
    };
  };

  show("labelBorder", { borderWidth: 1 });
  show("merchantLogo");
  show("indiaPostBarcode", { align: "center", fontSize: 11, fontWeight: "bold", showArticleText: true });
  show("customerId", { fontWeight: "bold", fontSize: 11 });
  show("articleType", { fontWeight: "bold", fontSize: 11, align: "right" });
  show("orderIdDate");
  show("parcelSize");
  show("codAmount", { align: "right", fontWeight: "bold", autoHeight: true });
  show("prepaid", { align: "right", fontWeight: "bold" });
  show("shipTo", {
    fontSize: 11,
    fontWeight: "bold",
    autoHeight: true,
    addressLayout: defaultAddressLayout("Ship To:"),
  });
  show("fromAddress", {
    autoHeight: true,
    addressLayout: defaultAddressLayout("From/ Return Address"),
  });
  show("products", {
    fontSize: 9,
    autoHeight: true,
    showName: true,
    showSku: false,
    showDescription: false,
    showQuantity: true,
    showWeight: true,
    showPrice: true,
    showCustomNote: false,
  });

  const page = { paperSize: "custom" as const, widthPt, heightPt, widthMm, heightMm };
  return {
    templateVersion: 5,
    page,
    elements: arrangeIndiaPostBands(elements, page),
  };
}

export function parseLabelTemplate(value: unknown): LabelTemplate {
  const parsed = labelTemplateSchema.safeParse(value);
  if (parsed.success && Object.keys(parsed.data.elements).length > 0) {
    if (parsed.data.templateVersion >= 4) return ensureIndependentBlocks(parsed.data);
    const size =
      parsed.data.page.paperSize === "A6" || parsed.data.page.paperSize === "4x6"
        ? "A5"
        : parsed.data.page.paperSize === "custom"
          ? "A4"
          : parsed.data.page.paperSize;
    return defaultLabelTemplate(size);
  }
  return defaultLabelTemplate();
}

export function applyPaperSize(template: LabelTemplate, paperSize: PaperSizeId): LabelTemplate {
  const page = pagePreset(paperSize);
  const elements: LabelTemplate["elements"] = {};
  for (const [id, element] of Object.entries(template.elements)) {
    const clamped = clampRect(element, page.widthPt, page.heightPt);
    elements[id] = { ...element, ...clamped };
  }
  placeOverlayFields(page, elements);
  const next = ensureIndependentBlocks({
    ...template,
    templateVersion: Math.max(template.templateVersion, 4),
    page: { paperSize: page.id, widthPt: page.widthPt, heightPt: page.heightPt },
    elements,
  });
  const indiaPost =
    next.elements.indiaPostBarcode?.visible || next.elements.shipTo?.visible || next.elements.customerId?.visible;
  if (!indiaPost) return next;
  return { ...next, elements: arrangeIndiaPostBands(next.elements, next.page) };
}

export { PAGE_PRESETS };
