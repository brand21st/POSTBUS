import { z } from "zod";
import { clampRect } from "@/modules/labels/collision";
import { PAGE_PRESETS, officialDrawRect, pagePreset, type PagePreset, type PaperSizeId } from "@/modules/labels/page-presets";

export const MERCHANT_ELEMENT_IDS = [
  "merchantLogo",
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
] as const;

export type MerchantElementId = (typeof MERCHANT_ELEMENT_IDS)[number];

export const MERCHANT_OVERLAY_IDS = ["merchantLogo", "orderNumber", "products", "total"] as const;
export type MerchantOverlayId = (typeof MERCHANT_OVERLAY_IDS)[number];

export const MERCHANT_ELEMENT_LABELS: Record<MerchantElementId, string> = {
  merchantLogo: "Store logo",
  storeName: "Store name",
  storePhone: "Store phone",
  storeWebsite: "Store website",
  orderNumber: "Order number",
  shopifyOrderNumber: "Shopify order number",
  products: "Products",
  subtotal: "Subtotal",
  shipping: "Shipping",
  discount: "Discount",
  total: "Price",
  codAmount: "COD amount",
  paymentMethod: "Payment method",
  customerNote: "Customer note",
  customText: "Custom text",
  promotionalMessage: "Promotional message",
  returnAddress: "Return address",
  returnPolicy: "Return policy",
  customerSupport: "Support information",
};

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
  content: z.string().optional(),
  showName: z.boolean().optional(),
  showSku: z.boolean().optional(),
  showQuantity: z.boolean().optional(),
  showPrice: z.boolean().optional(),
});

export const labelTemplateSchema = z.object({
  templateVersion: z.number().int().min(1),
  page: z.object({
    paperSize: z.enum(["A6", "4x6", "A5", "A4"]),
    widthPt: z.number(),
    heightPt: z.number(),
  }),
  elements: z.record(z.string(), elementSchema),
});

export type LabelTemplate = z.infer<typeof labelTemplateSchema>;
export type TemplateElement = z.infer<typeof elementSchema>;

const DEFAULT_VISIBLE: MerchantElementId[] = ["merchantLogo", "orderNumber", "products", "total"];

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
      fontSize: id === "storeName" ? 12 : 9,
      fontWeight: id === "storeName" || id === "total" || id === "codAmount" ? "bold" : "normal",
      align: "left",
      showName: true,
      showSku: false,
      showQuantity: true,
      showPrice: true,
      ...extra,
    };
  };

  place("merchantLogo", 36, { width: 90, height: 36 });
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
  place("customText", 24, { content: "" });
  place("promotionalMessage", 24, { content: "" });
  place("returnAddress", 36);
  place("returnPolicy", 28, { content: "Returns accepted within 7 days in original condition." });
  place("customerSupport", 24, { content: "" });
  placeOverlayFields(page, elements);

  return {
    templateVersion: 3,
    page: {
      paperSize: page.id,
      widthPt: page.widthPt,
      heightPt: page.heightPt,
    },
    elements,
  };
}

export function parseLabelTemplate(value: unknown): LabelTemplate {
  const parsed = labelTemplateSchema.safeParse(value);
  if (parsed.success && Object.keys(parsed.data.elements).length > 0) {
    if (parsed.data.templateVersion >= 3) return parsed.data;
    const size =
      parsed.data.page.paperSize === "A6" || parsed.data.page.paperSize === "4x6"
        ? "A5"
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
  return {
    ...template,
    templateVersion: Math.max(template.templateVersion, 3),
    page: { paperSize: page.id, widthPt: page.widthPt, heightPt: page.heightPt },
    elements,
  };
}

export { PAGE_PRESETS };
