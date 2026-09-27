import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { orderNumberCandidates, previewFromPacking } from "@/modules/labels/custom-label-service";
import { articleIdFromShipment, indiaPostBarcodePng } from "@/modules/labels/india-post-barcode-image";
import { SAMPLE_SHIP_PARTS, addressLineTexts, addressPartsFromParty, composeAddressLines, defaultAddressLayout, wrapAddressRuns } from "@/modules/labels/address-layout";
import { SAMPLE_PACKING_DATA, loadLogoBytes } from "@/modules/labels/packing-data";
import { articleContractLine, amountInIndianRupees, blockPreviewLines, createCustomTextElement, CUSTOM_LABEL_BLOCKS, customerIdLine, LABEL_GENERATED_FROM, nextCustomTextId, parcelSizeLines, productTable, productTableHeight, wrapProductCell, serviceContractLine, type CustomLabelPreview } from "@/modules/labels/custom-blocks";
import { indiaPostVolumetricWeightGrams } from "@/modules/india-post/endpoints";
import { customBlockVisibility, renderMerchantLabelPdf } from "@/modules/labels/packing-pdf";
import { printMediaForPage, sizeChoiceForPage } from "@/modules/labels/page-presets";
import {
  applyPaperSize,
  defaultLabelTemplate,
  fitAddressBox,
  growAutoHeightBox,
  elementBoxFromMm,
  elementBoxMm,
  horizontalLineBars,
  indiaPostLabelTemplate,
  MERCHANT_ELEMENT_IDS,
  normalizeHLines,
  parseLabelTemplate,
} from "@/modules/labels/template-schema";

async function pdfContents(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const parts: string[] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const text = Buffer.from(decodePDFRawStream(object).decode()).toString("latin1");
    parts.push(
      text.replace(/<([0-9A-Fa-f]+)>/g, (token, hex: string) =>
        hex.length % 2 === 0 ? Buffer.from(hex, "hex").toString("latin1") : token
      )
    );
  }
  return parts.join("\n");
}

async function imageCount(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const resources = pdf.getPages()[0].node.Resources();
  const xObject = resources?.get(PDFName.of("XObject"));
  if (!xObject) return 0;
  const dict = pdf.context.lookup(xObject);
  return dict instanceof PDFDict ? dict.keys().length : 0;
}

describe("india post barcode block", () => {
  it("keeps a version 4 template and adds the barcode block hidden", () => {
    const current = defaultLabelTemplate("A4");
    const stored = {
      ...current,
      elements: Object.fromEntries(Object.entries(current.elements).filter(([id]) => id !== "indiaPostBarcode")),
    };
    const parsed = parseLabelTemplate(stored);
    expect(parsed.templateVersion).toBe(4);
    expect(parsed.elements.receiverName.visible).toBe(current.elements.receiverName.visible);
    expect(parsed.elements.indiaPostBarcode.visible).toBe(false);
    expect(parsed.elements.indiaPostBarcode.x).toBeGreaterThanOrEqual(0);
  });

  it("round-trips barcode position, size, and properties", () => {
    const template = indiaPostLabelTemplate();
    template.elements.indiaPostBarcode = {
      ...template.elements.indiaPostBarcode,
      x: 410,
      y: 460,
      width: 300,
      height: 90,
      visible: true,
      align: "center",
      fontSize: 12,
      showArticleText: true,
    };
    template.library = [
      {
        id: "india-post",
        name: "India Post",
        isDefault: true,
        page: template.page,
        elements: template.elements,
      },
    ];
    const parsed = parseLabelTemplate(template);
    const barcode = parsed.library?.[0].elements.indiaPostBarcode;
    expect(barcode).toMatchObject({
      x: 410,
      y: 460,
      width: 300,
      height: 90,
      visible: true,
      align: "center",
      fontSize: 12,
      showArticleText: true,
    });
    expect(parsed.page.widthMm).toBe(297);
    expect(parsed.page.heightMm).toBe(210);
  });

  it("uses the shipment tracking number before the barcode column", () => {
    expect(articleIdFromShipment({ tracking_number: "CL626422400IN", barcode: "ET000000000IN" })).toBe(
      "CL626422400IN"
    );
    expect(articleIdFromShipment({ tracking_number: "pending", barcode: "CL626422400IN" })).toBe("CL626422400IN");
    expect(articleIdFromShipment({ tracking_number: "", barcode: "not-an-article" })).toBe("");
  });

  it("encodes only a valid India Post article id", async () => {
    const source = readFileSync(path.join(process.cwd(), "modules/labels/india-post-barcode-image.ts"), "utf8");
    expect(source).toContain('bcid: "code128"');
    expect(source).toContain("includetext: false");
    await expect(indiaPostBarcodePng("CL626422400IN")).resolves.toBeInstanceOf(Buffer);
    await expect(indiaPostBarcodePng("sample")).resolves.toBeNull();
    await expect(indiaPostBarcodePng("")).resolves.toBeNull();
  });

  it("draws the barcode inside its block and skips an invalid article", async () => {
    const template = indiaPostLabelTemplate();
    const withArticle = await renderMerchantLabelPdf(template, {
      ...SAMPLE_PACKING_DATA,
      articleId: "CL626422400IN",
      paymentMode: "PREPAID",
    });
    const withoutArticle = await renderMerchantLabelPdf(template, {
      ...SAMPLE_PACKING_DATA,
      articleId: "",
      paymentMode: "PREPAID",
    });
    const pdf = await PDFDocument.load(withArticle);
    const size = pdf.getPages()[0].getSize();
    expect(Math.round(size.width)).toBe(Math.round(template.page.widthPt));
    expect(Math.round(size.height)).toBe(Math.round(template.page.heightPt));
    expect(await imageCount(withArticle)).toBeGreaterThan(0);
    expect(await imageCount(withoutArticle)).toBe(0);
  });

  it("shows COD or Prepaid, and omits a hidden barcode for both", () => {
    const template = indiaPostLabelTemplate();
    expect(customBlockVisibility(template, { ...SAMPLE_PACKING_DATA, paymentMode: "COD" })).toMatchObject({
      barcode: true,
      cod: true,
      prepaid: false,
    });
    expect(customBlockVisibility(template, { ...SAMPLE_PACKING_DATA, paymentMode: "PREPAID" })).toMatchObject({
      barcode: true,
      cod: false,
      prepaid: true,
    });
    template.elements.indiaPostBarcode = { ...template.elements.indiaPostBarcode, visible: false };
    expect(customBlockVisibility(template, { ...SAMPLE_PACKING_DATA, paymentMode: "COD" }).barcode).toBe(false);
    expect(customBlockVisibility(template, { ...SAMPLE_PACKING_DATA, paymentMode: "PREPAID" }).barcode).toBe(false);
  });

  it("prints the COD amount in rupees and in words", async () => {
    expect(amountInIndianRupees(2597)).toBe("Rupees Two Thousand Five Hundred Ninety Seven Only");
    expect(amountInIndianRupees(10.5)).toBe("Rupees Ten and Fifty Paise Only");
    expect(amountInIndianRupees(125000)).toBe("Rupees One Lakh Twenty Five Thousand Only");
    const pdf = await pdfContents(
      await renderMerchantLabelPdf(indiaPostLabelTemplate(), { ...SAMPLE_PACKING_DATA, paymentMode: "COD", codAmount: 2597 })
    );
    expect(pdf).toContain("COD");
    expect(pdf).toContain("Amount:");
    expect(pdf).toContain("Rupees Two Thousand Five Hundred Ninety Seven Only");
  });

  it("prints multiple custom text blocks", async () => {
    const template = indiaPostLabelTemplate();
    template.elements.customText = {
      ...template.elements.customText,
      visible: true,
      content: "Handle with care",
      autoHeight: true,
    };
    template.elements.customText2 = {
      ...createCustomTextElement(template.page, 1),
      visible: true,
      content: "Fragile parcel",
    };
    expect(nextCustomTextId(template.elements)).toBe("customText3");
    const pdf = await pdfContents(await renderMerchantLabelPdf(template, SAMPLE_PACKING_DATA));
    expect(pdf).toContain("Handle with care");
    expect(pdf).toContain("Fragile parcel");
  });

  it("always prints a small generated-from header", async () => {
    const pdf = await pdfContents(await renderMerchantLabelPdf(indiaPostLabelTemplate(), SAMPLE_PACKING_DATA));
    expect(pdf).toContain(LABEL_GENERATED_FROM);
    expect(LABEL_GENERATED_FROM).toBe("Label Generated From www.postbus.in");
  });

  it("maps the organization logo onto custom preview and PDF bytes", async () => {
    const logoUrl = "https://example.supabase.co/storage/v1/object/public/organization-assets/org-a/logo.png";
    const preview = previewFromPacking({ ...SAMPLE_PACKING_DATA, logoUrl }, "ship-1");
    expect(preview.logoUrl).toBe(logoUrl);

    const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(png, { status: 200, headers: { "content-type": "image/png" } });
    const loaded = await loadLogoBytes(
      { storage: { from: () => ({ download: async () => ({ data: null }) }) } } as never,
      "org-a/logo.png"
    );
    expect(loaded?.mime).toBe("image/png");
    expect(Array.from(loaded?.bytes ?? [])).toEqual(Array.from(png));
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  });

  it("uses custom size for 297 by 210 and A4 for 210 by 297", () => {
    const indiaPost = indiaPostLabelTemplate();
    expect(indiaPost.page.paperSize).toBe("custom");
    expect(indiaPost.page.widthMm).toBe(297);
    expect(indiaPost.page.heightMm).toBe(210);
    expect(sizeChoiceForPage(indiaPost.page)).toBe("custom");
    expect(sizeChoiceForPage(defaultLabelTemplate("A4").page)).toBe("A4");
    const legacy = parseLabelTemplate({
      templateVersion: 4,
      page: { paperSize: "A4", widthPt: 595.28, heightPt: 841.89 },
      elements: defaultLabelTemplate("A4").elements,
    });
    expect(legacy.page.paperSize).toBe("A4");
    expect(parseLabelTemplate(indiaPost).page.paperSize).toBe("custom");
  });

  it("shows product name, quantity, weight, and price in columns", async () => {
    const template = indiaPostLabelTemplate();
    const table = productTable(
      [{ title: "Organic Cotton T-Shirt", quantity: 2, unitPrice: 599, weightGrams: 180 }],
      template.elements.products,
      { includeTotal: !template.elements.total?.visible, total: 1198 }
    );
    expect(table.columns.map((column) => column.label)).toEqual(["Product name", "Qty", "Weight (g)", "Price"]);
    expect(table.rows[0].cells).toEqual(["Organic Cotton T-Shirt", "2", "360g", "Rs. 1,198.00"]);
    expect(table.rows.at(-1)).toMatchObject({ bold: true, cells: ["Total", "", "", "Rs. 1,198.00"] });

    const demo = productTable(
      [{ title: "demo 2", quantity: 1, unitPrice: 10, weightGrams: null }],
      template.elements.products,
      { includeTotal: true, total: 10 }
    );
    expect(demo.rows[0].cells).toEqual(["demo 2", "1", "", "Rs. 10.00"]);

    const hiddenWeight = productTable(
      [{ title: "demo 2", quantity: 1, unitPrice: 10, weightGrams: 100 }],
      { ...template.elements.products, showWeight: false },
      { includeTotal: false }
    );
    expect(hiddenWeight.columns.map((column) => column.id)).not.toContain("weight");
    expect(hiddenWeight.rows[0].cells).toEqual(["demo 2", "1", "Rs. 10.00"]);

    template.elements.total = { ...template.elements.total, visible: true };
    const separateTotal = productTable(
      [{ title: "demo 2", quantity: 1, unitPrice: 10 }],
      template.elements.products,
      { includeTotal: !template.elements.total?.visible, total: 10 }
    );
    expect(separateTotal.rows.some((row) => row.cells.includes("Total"))).toBe(false);

    const pdf = await pdfContents(
      await renderMerchantLabelPdf(indiaPostLabelTemplate(), {
        ...SAMPLE_PACKING_DATA,
        items: [{ title: "Organic Cotton T-Shirt", sku: null, quantity: 2, unitPrice: 599, weightGrams: 180 }],
        total: 1198,
      })
    );
    expect(pdf).toContain("Product name");
    expect(pdf).toContain("Weight (g)");
    expect(pdf).toContain("360g");
    expect(pdf).toContain("Rs. 1,198.00");
  });

  it("wraps a long product name and grows the product list when auto height is on", async () => {
    expect(wrapProductCell("Organic Cotton T-Shirt Extra Long Name", 40, 9).length).toBeGreaterThan(1);
    const template = indiaPostLabelTemplate();
    const items = [{ title: "Organic Cotton T-Shirt Extra Long Name For The Label", quantity: 1, unitPrice: 10, weightGrams: 100 }];
    const short = { ...template.elements.products, width: 120, height: 36, autoHeight: true };
    const needed = productTableHeight(short, items, { includeTotal: true, total: 10 });
    const grown = growAutoHeightBox(short, template.page, needed);
    expect(grown.height).toBeGreaterThan(36);
    const manual = growAutoHeightBox({ ...grown, height: 24, autoHeight: false }, template.page, needed);
    expect(manual.height).toBe(24);
    const pdf = await pdfContents(
      await renderMerchantLabelPdf(
        { ...template, elements: { ...template.elements, products: { ...template.elements.products, width: 140, autoHeight: true } } },
        { ...SAMPLE_PACKING_DATA, items, total: 10 }
      )
    );
    expect(pdf).toContain("Organic");
    expect(pdf).toContain("Label");
  });

  it("shows the service contract id under the article type", async () => {
    const template = indiaPostLabelTemplate();
    const article = template.elements.articleType;
    const contract = template.elements.serviceContractId;
    expect(contract.visible).toBe(false);

    const saved = {
      ...template,
      elements: Object.fromEntries(Object.entries(template.elements).filter(([id]) => id !== "serviceContractId")),
    };
    const filled = parseLabelTemplate(saved);
    expect(filled.elements.serviceContractId.visible).toBe(true);
    expect(filled.elements.serviceContractId.y).toBe(article.y - 28);

    const current = defaultLabelTemplate("A4");
    const hidden = parseLabelTemplate({
      ...current,
      elements: Object.fromEntries(Object.entries(current.elements).filter(([id]) => id !== "serviceContractId")),
    });
    expect(hidden.elements.serviceContractId.visible).toBe(false);

    const preview: CustomLabelPreview = {
      shipmentId: "shipment",
      articleId: "CL556974029IN",
      articleType: "Business Parcel",
      contractId: "41793509",
      customerId: "1000058877",
      paymentMode: "PREPAID",
      orderNumber: "#2268",
      orderDate: "27 September 2026",
      fromLines: ["Store"],
      shipLines: ["Customer"],
      items: [],
      total: 10,
      codAmount: 0,
    };
    expect(blockPreviewLines("serviceContractId", null)).toEqual(["Contract ID"]);
    expect(blockPreviewLines("serviceContractId", preview)).toEqual(["Contract ID: 41793509"]);
    expect(blockPreviewLines("serviceContractId", { ...preview, contractId: "" })).toEqual([
      "Service contract ID not available",
    ]);
    expect(serviceContractLine("41793509")).toBe("Contract ID: 41793509");
    expect(serviceContractLine("")).toBe("");
    expect(articleContractLine("Business Parcel", "41793509")).toBe("Business Parcel : 41793509");
    expect(articleContractLine("Speed Post parcel", "88")).toBe("Speed Post parcel : 88");
    expect(customerIdLine("1000058877")).toBe("Customer ID: 1000058877");
    expect(customerIdLine("")).toBe("");
    expect(blockPreviewLines("articleType", preview)).toEqual(["Business Parcel : 41793509"]);
    expect(blockPreviewLines("customerId", preview)).toEqual(["Customer ID: 1000058877"]);

    const withContract = await pdfContents(
      await renderMerchantLabelPdf(template, {
        ...SAMPLE_PACKING_DATA,
        articleType: "Business Parcel",
        contractId: "41793509",
        customerId: "1000058877",
      })
    );
    const withoutContract = await pdfContents(
      await renderMerchantLabelPdf(template, {
        ...SAMPLE_PACKING_DATA,
        articleType: "Speed Post parcel",
        contractId: "",
        customerId: "",
      })
    );
    expect(withContract).toContain("Business Parcel : 41793509");
    expect(withContract).toContain("Customer ID: 1000058877");
    expect(withoutContract).toContain("Speed Post parcel");
    expect(withoutContract).not.toContain("Contract ID:");
    expect(withoutContract).not.toContain("Customer ID:");
  });

  it("shows box size, weight, and volumetric under the order id", async () => {
    const template = indiaPostLabelTemplate();
    const order = template.elements.orderIdDate;
    const parcel = template.elements.parcelSize;
    expect(parcel.visible).toBe(true);
    expect(parcel.x).toBe(order.x);
    expect(parcel.y).toBeLessThan(order.y);

    const saved = {
      ...template,
      elements: Object.fromEntries(Object.entries(template.elements).filter(([id]) => id !== "parcelSize")),
    };
    const filled = parseLabelTemplate(saved);
    expect(filled.elements.parcelSize.visible).toBe(true);
    expect(filled.elements.parcelSize.y).toBe(order.y - 40);

    const current = defaultLabelTemplate("A4");
    const hidden = parseLabelTemplate({
      ...current,
      elements: Object.fromEntries(Object.entries(current.elements).filter(([id]) => id !== "parcelSize")),
    });
    expect(hidden.elements.parcelSize.visible).toBe(false);

    const lines = parcelSizeLines({ lengthCm: 30, widthCm: 20, heightCm: 4, weightGrams: 500 }, true);
    expect(lines).toEqual([
      "Box: 30 × 20 × 4 cm",
      "Weight: 500 g",
      `Volumetric: ${indiaPostVolumetricWeightGrams(30, 20, 4)} g`,
    ]);
    expect(indiaPostVolumetricWeightGrams(30, 20, 4)).toBe(480);
    expect(parcelSizeLines({ weightGrams: 0 }, true)).toEqual(["Weight not available"]);
    expect(blockPreviewLines("parcelSize", null)).toEqual([
      "Box: 30 × 20 × 4 cm",
      "Weight: 500 g",
      "Volumetric: 480 g",
    ]);

    const pdf = await pdfContents(
      await renderMerchantLabelPdf(template, {
        ...SAMPLE_PACKING_DATA,
        weightGrams: 500,
        lengthCm: 30,
        widthCm: 20,
        heightCm: 4,
      })
    );
    expect(pdf).toContain("Box: 30 × 20 × 4 cm");
    expect(pdf).toContain("Weight: 500 g");
    expect(pdf).toContain("Volumetric: 480 g");
  });

  it("round-trips block font, spacing, and millimetre position", async () => {
    const template = indiaPostLabelTemplate();
    const moved = elementBoxFromMm(template.elements.fromAddress, template.page, { xMm: 0, yMm: 15 });
    template.elements.fromAddress = {
      ...template.elements.fromAddress,
      ...moved,
      align: "center",
      fontWeight: "bold",
      fontSize: 12,
      lineGap: 4,
      gap: 2,
    };
    const parsed = parseLabelTemplate(template);
    expect(parsed.elements.fromAddress).toMatchObject({
      align: "center",
      fontWeight: "bold",
      fontSize: 12,
      lineGap: 4,
      gap: 2,
    });
    const box = elementBoxMm(parsed.elements.fromAddress, parsed.page.heightPt);
    expect(box.xMm).toBeCloseTo(0, 1);
    expect(box.yMm).toBeCloseTo(15, 1);

    const pdf = await pdfContents(await renderMerchantLabelPdf(parsed, SAMPLE_PACKING_DATA));
    expect(pdf).toContain("From");
    expect(pdf).toContain("Helvetica-Bold");
    expect(pdf).toContain("12 Tf");
  });

  it("lets each ship-to address field be shown, joined, and styled", async () => {
    const layout = defaultAddressLayout("Ship To:");
    const city = layout.fields.find((field) => field.id === "city");
    const state = layout.fields.find((field) => field.id === "state");
    if (city) city.bold = true;
    if (state) state.italic = true;
    const parts = addressPartsFromParty(SAMPLE_PACKING_DATA.receiver);
    expect(addressLineTexts(layout, parts)).toEqual([
      "Ship To:",
      "Priya Nair",
      "14 Lake View",
      "Ernakulam, Kerala",
      "682016, India, Mobile: 9876501234",
    ]);
    const composed = composeAddressLines(layout, parts);
    expect(composed.lines[2]?.[0]).toMatchObject({ text: "Ernakulam", bold: true });
    expect(composed.lines[2]?.[2]).toMatchObject({ text: "Kerala", italic: true });

    const template = indiaPostLabelTemplate();
    template.elements.shipTo = { ...template.elements.shipTo, addressLayout: layout, fontSize: 14 };
    const parsed = parseLabelTemplate(template);
    expect(parsed.elements.shipTo.addressLayout?.headingText).toBe("Ship To:");
    expect(parsed.elements.shipTo.addressLayout?.fields?.some((field) => field.id === "city" && field.sameLineAsNext)).toBe(true);
    const pdf = await pdfContents(await renderMerchantLabelPdf(parsed, SAMPLE_PACKING_DATA));
    expect(pdf).toContain("Ship To:");
    expect(pdf).toContain("Ernakulam");
    expect(pdf).toContain("14 Tf");
  });

  it("fits the label border to the full page", () => {
    const template = indiaPostLabelTemplate();
    expect(template.elements.labelBorder).toMatchObject({
      x: 0,
      y: 0,
      width: template.page.widthPt,
      height: template.page.heightPt,
    });
    const inset = parseLabelTemplate({
      ...template,
      elements: {
        ...template.elements,
        labelBorder: { ...template.elements.labelBorder, x: 12, y: 12, width: 100, height: 80 },
      },
    });
    expect(inset.elements.labelBorder).toMatchObject({
      x: 0,
      y: 0,
      width: inset.page.widthPt,
      height: inset.page.heightPt,
    });
    const a6 = applyPaperSize(template, "A6");
    expect(a6.elements.labelBorder.width).toBe(a6.page.widthPt);
    expect(a6.elements.labelBorder.height).toBe(a6.page.heightPt);
  });

  it("round-trips five horizontal border lines and skips a hidden one", async () => {
    const template = indiaPostLabelTemplate();
    const lines = normalizeHLines(undefined, template.page.heightPt).map((line, index) =>
      index === 2 ? { ...line, visible: false } : line
    );
    template.elements.labelBorder = {
      ...template.elements.labelBorder,
      hLineWidth: 2,
      hLineGapMm: 4,
      hLines: lines,
    };
    const parsed = parseLabelTemplate(template);
    expect(parsed.elements.labelBorder.hLineWidth).toBe(2);
    expect(parsed.elements.labelBorder.hLineGapMm).toBe(4);
    expect(parsed.elements.labelBorder.hLines).toHaveLength(5);
    expect(parsed.elements.labelBorder.hLines?.[2]?.visible).toBe(false);

    const bars = horizontalLineBars(parsed.elements.labelBorder, parsed.page.heightPt);
    expect(bars).toHaveLength(4);
    const hiddenY = parsed.page.heightPt - (lines[2]?.yMm ?? 0) * (72 / 25.4);
    expect(bars.some((bar) => Math.abs(bar.y - hiddenY) < 3)).toBe(false);

    const pdf = await pdfContents(await renderMerchantLabelPdf(parsed, SAMPLE_PACKING_DATA));
    expect(pdf).toContain(bars[0]?.y.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") || "missing");
  });

  it("round-trips label border thickness into the PDF stroke", async () => {
    const template = indiaPostLabelTemplate();
    template.elements.labelBorder = { ...template.elements.labelBorder, borderWidth: 3 };
    const parsed = parseLabelTemplate(template);
    expect(parsed.elements.labelBorder.borderWidth).toBe(3);
    const pdf = await pdfContents(await renderMerchantLabelPdf(parsed, SAMPLE_PACKING_DATA));
    expect(pdf).toContain("3 w");
  });

  it("stacks India Post blocks in the official order on every paper size", () => {
    const wide = indiaPostLabelTemplate();
    const narrow = applyPaperSize(wide, "A6");
    for (const template of [wide, narrow]) {
      const elements = template.elements;
      expect(elements.indiaPostBarcode.y).toBeGreaterThan(elements.customerId.y);
      expect(elements.customerId.y).toBeGreaterThan(elements.shipTo.y);
      expect(elements.shipTo.y).toBeGreaterThan(elements.fromAddress.y);
      expect(elements.fromAddress.y).toBeGreaterThan(elements.products.y);
      expect(elements.customerId.x).toBeLessThan(elements.articleType.x);
      expect(elements.codAmount.visible).toBe(true);
      expect(elements.prepaid.visible).toBe(true);
      expect(elements.serviceContractId.visible).toBe(false);
      expect(elements.labelBorder.hLines).toHaveLength(5);
    }
  });

  it("maps a template page to the printer paper and orientation", () => {
    const wide = indiaPostLabelTemplate();
    expect(printMediaForPage(wide.page)).toEqual({ paperSize: "A4", orientation: "landscape" });
    expect(printMediaForPage(defaultLabelTemplate("A6").page)).toEqual({ paperSize: "A6", orientation: "portrait" });
    expect(printMediaForPage(defaultLabelTemplate("4x6").page)).toEqual({ paperSize: "4x6", orientation: "portrait" });
  });

  it("wraps a long street and grows the address box when auto height is on", async () => {
    const wrapped = wrapAddressRuns(
      [{ text: "42 MG Road Near City Mall Bengaluru", bold: false, italic: false }],
      40,
      (text) => text.length * 6
    );
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped.flat().map((run) => run.text).join("")).toContain("Bengaluru");

    const template = indiaPostLabelTemplate();
    const street = "42 MG Road, Near City Mall, Opposite the Old Railway Station";
    const grown = fitAddressBox(
      { ...template.elements.shipTo, width: 120, autoHeight: true },
      template.page,
      { ...SAMPLE_SHIP_PARTS, street }
    );
    expect(grown.height).toBeGreaterThan(template.elements.shipTo.height);
    const manual = fitAddressBox({ ...grown, height: 24, autoHeight: false }, template.page, SAMPLE_SHIP_PARTS);
    expect(manual.height).toBe(24);
    expect(manual.autoHeight).toBe(false);

    const pdf = await pdfContents(
      await renderMerchantLabelPdf(
        { ...template, elements: { ...template.elements, shipTo: { ...template.elements.shipTo, width: 140, autoHeight: true } } },
        { ...SAMPLE_PACKING_DATA, receiver: { ...SAMPLE_PACKING_DATA.receiver, street, name: "Priya Sharma" } }
      )
    );
    expect(pdf).toContain("Priya Sharma");
    expect(pdf).toContain("Railway");
    expect(pdf).toContain("From/ Return Address");
    expect(pdf).toContain("Sample Store");
  });

  it("wires every editor block through the template, parse, and PDF", async () => {
    const template = indiaPostLabelTemplate();
    const visible = [
      "labelBorder",
      "merchantLogo",
      "indiaPostBarcode",
      "customerId",
      "articleType",
      "orderIdDate",
      "parcelSize",
      "codAmount",
      "prepaid",
      "shipTo",
      "fromAddress",
      "products",
    ];
    for (const block of CUSTOM_LABEL_BLOCKS) {
      expect(template.elements[block.id], block.id).toBeTruthy();
    }
    for (const id of visible) expect(template.elements[id]?.visible).toBe(true);
    expect(template.elements.serviceContractId.visible).toBe(false);
    expect(template.elements.customText.visible).toBe(false);

    const stripped = {
      ...template,
      elements: Object.fromEntries(
        Object.entries(template.elements).filter(([id]) => !CUSTOM_LABEL_BLOCKS.some((block) => block.id === id))
      ),
    };
    const restored = parseLabelTemplate(stripped);
    for (const block of CUSTOM_LABEL_BLOCKS) {
      expect(restored.elements[block.id], block.id).toBeTruthy();
    }

    template.elements.customText2 = {
      ...createCustomTextElement(template.page, 1),
      visible: true,
      content: "Second note",
    };
    const roundTrip = parseLabelTemplate(JSON.parse(JSON.stringify(template)));
    expect(roundTrip.elements.customText2?.content).toBe("Second note");
    expect(MERCHANT_ELEMENT_IDS).not.toContain("customText2");

    const printed = {
      ...template,
      elements: {
        ...template.elements,
        serviceContractId: { ...template.elements.serviceContractId, visible: true },
        customText: { ...template.elements.customText, visible: true, content: "Handle with care" },
      },
    };
    const pdf = await pdfContents(
      await renderMerchantLabelPdf(printed, {
        ...SAMPLE_PACKING_DATA,
        paymentMode: "COD",
        paymentMethod: "COD",
        codAmount: 2597,
        customerId: "1000058877",
        articleType: "Business Parcel",
        contractId: "41793509",
        articleId: "CL556974029IN",
        orderNumber: "2268",
        orderDate: "28 Sep 2026",
        weightGrams: 500,
        lengthCm: 30,
        widthCm: 20,
        heightCm: 4,
      })
    );
    expect(pdf).toContain("Customer ID: 1000058877");
    expect(pdf).toContain("Business Parcel : 41793509");
    expect(pdf).toContain("Contract ID: 41793509");
    expect(pdf).toContain("Order ID: 2268");
    expect(pdf).toContain("Box:");
    expect(pdf).toContain("COD");
    expect(pdf).toContain("Rupees Two Thousand Five Hundred Ninety Seven Only");
    expect(pdf).not.toContain("PRE PAID");
    expect(pdf).toContain("Cotton Shirt");
    expect(pdf).toContain("From/ Return Address");
    expect(pdf).toContain("Ship To:");
    expect(pdf).toContain("Handle with care");
    expect(pdf).toContain("Second note");
    expect(pdf).toContain(LABEL_GENERATED_FROM);
    expect(pdf).toContain("CL556974029IN");
  });

  it("matches an order number with or without a hash", () => {
    expect(orderNumberCandidates("2268")).toEqual(["2268", "#2268"]);
    expect(orderNumberCandidates("#2268")).toEqual(["#2268", "2268"]);
  });
});
