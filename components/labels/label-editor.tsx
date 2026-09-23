"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { asPaginated } from "@/lib/dashboard/records";
import { fetchLabelPdfBlob } from "@/lib/labels/preview";
import { api } from "@/lib/hooks/use-api";
import { usePrintStation } from "@/lib/hooks/use-print-station";
import { snapRect } from "@/modules/labels/collision";
import { pickOfficialPreviewLabel } from "@/modules/labels/preview-pick";
import { OFFICIAL_LOCKED_ELEMENTS, OFFICIAL_LOCK_TOOLTIP } from "@/modules/labels/official-elements";
import { PAGE_PRESETS, pagePreset, type PaperSizeId } from "@/modules/labels/page-presets";
import {
  MERCHANT_ELEMENT_IDS,
  MERCHANT_ELEMENT_LABELS,
  applyPaperSize,
  defaultLabelTemplate,
  parseLabelTemplate,
  type LabelTemplate,
  type MerchantElementId,
} from "@/modules/labels/template-schema";
import type { LabelRecord, Paginated } from "@/types/api";

type PreviewData = {
  sample: boolean;
  shipmentId: string | null;
  data: {
    storeName: string;
    storePhone: string;
    storeWebsite: string;
    orderNumber: string;
    shopifyOrderNumber: string;
    items: Array<{ title: string; sku?: string | null; quantity: number; unitPrice: number }>;
    subtotal: number;
    shipping: number;
    discount: number;
    total: number;
    codAmount: number;
    paymentMethod: string;
    customerNote: string;
    returnAddress: string;
    hasLogo: boolean;
  };
};

function displayText(id: MerchantElementId, template: LabelTemplate, preview?: PreviewData["data"]) {
  const element = template.elements[id];
  const d = preview;
  if (!d) return MERCHANT_ELEMENT_LABELS[id];
  switch (id) {
    case "merchantLogo":
      return d.hasLogo ? "Store logo" : "Logo";
    case "storeName":
      return d.storeName;
    case "storePhone":
      return d.storePhone ? `Phone ${d.storePhone}` : "Store phone";
    case "storeWebsite":
      return d.storeWebsite || "Website";
    case "orderNumber":
      return d.orderNumber ? `Order ${d.orderNumber}` : "Order number";
    case "shopifyOrderNumber":
      return d.shopifyOrderNumber ? `Shopify ${d.shopifyOrderNumber}` : "Shopify order";
    case "products":
      return d.items.map((item) => `${item.title}  Qty ${item.quantity}  Rs ${item.unitPrice}`).join("\n") || "Products";
    case "subtotal":
      return `Subtotal  Rs ${d.subtotal.toFixed(2)}`;
    case "shipping":
      return `Shipping  Rs ${d.shipping.toFixed(2)}`;
    case "discount":
      return `Discount  Rs ${d.discount.toFixed(2)}`;
    case "total":
      return `Total  Rs ${d.total.toFixed(2)}`;
    case "codAmount":
      return `COD  Rs ${d.codAmount.toFixed(2)}`;
    case "paymentMethod":
      return d.paymentMethod ? `Payment  ${d.paymentMethod}` : "Payment method";
    case "customerNote":
      return d.customerNote ? `Note  ${d.customerNote}` : "Customer note";
    case "customText":
      return element?.content || "Custom text";
    case "promotionalMessage":
      return element?.content || "Promotional message";
    case "returnAddress":
      return d.returnAddress ? `Return to  ${d.returnAddress}` : "Return address";
    case "returnPolicy":
      return element?.content || "Return policy";
    case "customerSupport":
      return element?.content || (d.storePhone ? `Support  ${d.storePhone}` : "Support");
    default:
      return MERCHANT_ELEMENT_LABELS[id];
  }
}

export function LabelEditor() {
  const queryClient = useQueryClient();
  const station = usePrintStation();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [template, setTemplate] = useState<LabelTemplate>(defaultLabelTemplate());
  const [selected, setSelected] = useState<MerchantElementId | (typeof OFFICIAL_LOCKED_ELEMENTS)[number]["id"] | null>(
    "storeName"
  );
  const [lockedOfficial, setLockedOfficial] = useState<string | null>(null);
  const [warn, setWarn] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [testSize, setTestSize] = useState<PaperSizeId>("A6");
  const drag = useRef<{ id: MerchantElementId; dx: number; dy: number } | null>(null);

  const templateQuery = useQuery({
    queryKey: ["label-template"],
    queryFn: () => api<{ template: LabelTemplate }>("/api/v1/label-template"),
  });
  const previewQuery = useQuery({
    queryKey: ["label-template-preview-data"],
    queryFn: () => api<PreviewData>("/api/v1/label-template/preview-data"),
  });
  const labelsQuery = useQuery({
    queryKey: ["labels", "official-preview"],
    queryFn: () => api<Paginated<LabelRecord>>("/api/v1/labels?page=1&pageSize=50"),
  });

  const loaded = templateQuery.data?.template;
  useEffect(() => {
    if (loaded) setTemplate(parseLabelTemplate(loaded));
  }, [loaded]);

  const officialLabel = pickOfficialPreviewLabel(
    asPaginated<LabelRecord>(labelsQuery.data, ["labels", "items"]).items
  );

  const officialPdfQuery = useQuery({
    queryKey: ["labels", "official-pdf", officialLabel?.id],
    enabled: Boolean(officialLabel?.id),
    queryFn: async () => {
      const blob = await fetchLabelPdfBlob(officialLabel!.id);
      return URL.createObjectURL(blob);
    },
  });
  useEffect(() => {
    const href = officialPdfQuery.data;
    return () => {
      if (href) URL.revokeObjectURL(href);
    };
  }, [officialPdfQuery.data]);

  const page = pagePreset(template.page.paperSize);
  const scale = Math.min(360 / page.widthPt, 520 / page.heightPt);

  const updateElement = (id: MerchantElementId, patch: Partial<LabelTemplate["elements"][string]>) => {
    setTemplate((current) => ({
      ...current,
      elements: {
        ...current.elements,
        [id]: { ...current.elements[id], ...patch },
      },
    }));
  };

  const save = useMutation({
    mutationFn: () =>
      api<{ template: LabelTemplate }>("/api/v1/label-template", {
        method: "PUT",
        body: JSON.stringify({ template }),
      }),
    onSuccess: async (data) => {
      setTemplate(parseLabelTemplate(data.template));
      await queryClient.invalidateQueries({ queryKey: ["label-template"] });
      toast.success("Packing label template saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const printTest = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/v1/label-template/print-test", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, paperSize: testSize, copies: 1 }),
      });
      const contentType = response.headers.get("Content-Type") ?? "";
      if (contentType.includes("application/pdf")) {
        const blob = await response.blob();
        return { pdfUrl: URL.createObjectURL(blob), connected: false, message: "Opened the test PDF." };
      }
      const payload = (await response.json()) as {
        success?: boolean;
        message?: string;
        data?: { connected?: boolean; downloadPath?: string; message?: string };
      };
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || "Could not print the test label.");
      }
      return {
        connected: Boolean(payload.data?.connected),
        downloadPath: payload.data?.downloadPath,
        message: payload.data?.message || payload.message,
      };
    },
    onSuccess: (result) => {
      setPrintOpen(false);
      if ("pdfUrl" in result && result.pdfUrl) {
        window.open(result.pdfUrl, "_blank", "noopener,noreferrer");
      } else if (!result.connected && result.downloadPath) {
        window.open(result.downloadPath, "_blank", "noopener,noreferrer");
      }
      toast.success(result.message || "Test print queued.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const previewPdf = async () => {
    const response = await fetch("/api/v1/label-template/preview", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template, paperSize: template.page.paperSize }),
    });
    if (!response.ok) {
      toast.error("Could not render the packing PDF.");
      return;
    }
    const blob = await response.blob();
    window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
  };

  const onPointerDown = (id: MerchantElementId, event: React.PointerEvent) => {
    const el = template.elements[id];
    if (!el || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / scale;
    const displayY = (event.clientY - rect.top) / scale;
    const pdfY = page.heightPt - displayY - el.height;
    drag.current = { id, dx: x - el.x, dy: pdfY - el.y };
    setSelected(id);
    setLockedOfficial(null);
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const moveTo = (id: MerchantElementId, x: number, y: number, snapOnEnd = false) => {
    const el = template.elements[id];
    if (!el) return;
    const others = MERCHANT_ELEMENT_IDS.filter((key) => key !== id && template.elements[key]?.visible).map(
      (key) => template.elements[key]!
    );
    const result = snapOnEnd
      ? snapRect({ x, y, width: el.width, height: el.height }, others, page.widthPt, page.heightPt)
      : { rect: { x, y, width: el.width, height: el.height }, snapped: false };
    setWarn(result.snapped);
    updateElement(id, { x: result.rect.x, y: result.rect.y });
  };

  const selectedMerchant = selected && MERCHANT_ELEMENT_IDS.includes(selected as MerchantElementId)
    ? (selected as MerchantElementId)
    : null;
  const selectedEl = selectedMerchant ? template.elements[selectedMerchant] : null;
  const officialSelected = OFFICIAL_LOCKED_ELEMENTS.find((item) => item.id === lockedOfficial);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customize shipping label"
        description="Official India Post content stays locked. Edit the packing label that prints with your orders."
        actions={
          <>
            <Select
              value={template.page.paperSize}
              onValueChange={(value) => {
                setTemplate((current) => applyPaperSize(current, value as PaperSizeId));
              }}
            >
              <SelectTrigger className="w-[11rem]">
                <SelectValue placeholder="Label size" />
              </SelectTrigger>
              <SelectContent>
                {PAGE_PRESETS.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="secondary" onClick={() => void previewPdf()}>
              Preview
            </Button>
            <Button type="button" variant="secondary" onClick={() => { setTestSize(template.page.paperSize); setPrintOpen(true); }}>
              Print test
            </Button>
            <Button type="button" variant="secondary" onClick={() => setTemplate(defaultLabelTemplate(template.page.paperSize))}>
              <RotateCcw className="size-4" />
              Reset
            </Button>
            <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
              <Save className="size-4" />
              Save template
            </Button>
          </>
        }
      />

      {previewQuery.data?.sample ? (
        <p className="text-sm text-muted">Preview uses sample order data until this workspace has a real order.</p>
      ) : null}
      {warn ? (
        <p className="text-sm text-error">That position overlaps another element — snapped to the nearest free space.</p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[16rem_minmax(0,1fr)_16rem]">
        <aside className="space-y-5 rounded-2xl border border-border bg-card p-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Official India Post</p>
            <ul className="space-y-1">
              {OFFICIAL_LOCKED_ELEMENTS.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    title={OFFICIAL_LOCK_TOOLTIP}
                    onClick={() => {
                      setLockedOfficial(item.id);
                      setSelected(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted hover:bg-surface-soft"
                  >
                    <Lock className="size-3.5 shrink-0" />
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Merchant elements</p>
            <ul className="space-y-1">
              {MERCHANT_ELEMENT_IDS.map((id) => {
                const el = template.elements[id];
                return (
                  <li key={id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-soft">
                    <Checkbox
                      checked={Boolean(el?.visible)}
                      onCheckedChange={(checked) => updateElement(id, { visible: Boolean(checked) })}
                    />
                    <button
                      type="button"
                      className="flex-1 text-left text-sm text-ink"
                      onClick={() => {
                        setSelected(id);
                        setLockedOfficial(null);
                      }}
                    >
                      {MERCHANT_ELEMENT_LABELS[id]}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        <section className="rounded-2xl border border-border bg-card p-4">
          <Tabs defaultValue="merchant">
            <TabsList>
              <TabsTrigger value="official">Official India Post</TabsTrigger>
              <TabsTrigger value="merchant">Merchant packing label</TabsTrigger>
            </TabsList>
            <TabsContent value="official" className="pt-4">
              <div className="relative mx-auto overflow-hidden rounded-lg border border-border bg-white" style={{ width: 297, height: 420 }}>
                {officialPdfQuery.data ? (
                  <embed
                    title="Official India Post label"
                    src={officialPdfQuery.data}
                    type="application/pdf"
                    className="h-full w-full bg-white"
                  />
                ) : officialPdfQuery.isError ? (
                  <p className="p-6 text-sm text-muted">
                    {officialPdfQuery.error instanceof Error
                      ? officialPdfQuery.error.message
                      : "Could not open the India Post label."}
                  </p>
                ) : officialLabel ? (
                  <p className="p-6 text-sm text-muted">Loading the official India Post label…</p>
                ) : (
                  <p className="p-6 text-sm text-muted">Book a shipment to preview the real India Post PDF here. Official fields stay locked.</p>
                )}
                {OFFICIAL_LOCKED_ELEMENTS.map((item) => (
                  <div
                    key={item.id}
                    title={OFFICIAL_LOCK_TOOLTIP}
                    className={`pointer-events-none absolute border ${lockedOfficial === item.id ? "border-brand" : "border-transparent"}`}
                    style={{
                      left: item.x * (297 / 297.64),
                      bottom: item.y * (420 / 419.53),
                      width: item.width * (297 / 297.64),
                      height: item.height * (420 / 419.53),
                    }}
                  />
                ))}
              </div>
              {officialLabel ? (
                <p className="mt-2 text-center text-xs">
                  <a
                    className="text-brand underline"
                    href={`/api/v1/labels/${officialLabel.id}/download`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open official India Post PDF
                  </a>
                </p>
              ) : null}
            </TabsContent>
            <TabsContent value="merchant" className="pt-4">
              <div className="flex justify-center overflow-auto">
                <div
                  ref={canvasRef}
                  className="relative bg-white shadow-sm"
                  style={{
                    width: page.widthPt * scale,
                    height: page.heightPt * scale,
                    fontFamily: "Helvetica, Arial, sans-serif",
                  }}
                  onPointerMove={(event) => {
                    if (!drag.current || !canvasRef.current) return;
                    const el = template.elements[drag.current.id];
                    if (!el) return;
                    const rect = canvasRef.current.getBoundingClientRect();
                    const x = (event.clientX - rect.left) / scale - drag.current.dx;
                    const displayY = (event.clientY - rect.top) / scale;
                    const y = page.heightPt - displayY - el.height - drag.current.dy;
                    moveTo(drag.current.id, x, y);
                  }}
                  onPointerUp={() => {
                    if (drag.current) {
                      const el = template.elements[drag.current.id];
                      if (el) moveTo(drag.current.id, el.x, el.y, true);
                    }
                    drag.current = null;
                  }}
                >
                  <p className="absolute left-2 top-1 text-[8px] text-zinc-400">Merchant packing label</p>
                  {MERCHANT_ELEMENT_IDS.map((id) => {
                    const el = template.elements[id];
                    if (!el?.visible) return null;
                    return (
                      <button
                        key={id}
                        type="button"
                        onPointerDown={(event) => onPointerDown(id, event)}
                        className={`absolute overflow-hidden text-left ${selectedMerchant === id ? "ring-2 ring-brand" : "ring-1 ring-zinc-200"}`}
                        style={{
                          left: el.x * scale,
                          bottom: el.y * scale,
                          width: el.width * scale,
                          height: el.height * scale,
                          fontSize: (el.fontSize ?? 9) * scale,
                          fontWeight: el.fontWeight === "bold" ? 700 : 400,
                          textAlign: el.align ?? "left",
                          whiteSpace: "pre-wrap",
                          lineHeight: 1.2,
                        }}
                      >
                        {displayText(id, template, previewQuery.data?.data)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-muted">
                {page.label} · {Math.round(page.widthPt)} × {Math.round(page.heightPt)} pt — this is the page the printer receives.
              </p>
            </TabsContent>
          </Tabs>
        </section>

        <aside className="space-y-3 rounded-2xl border border-border bg-card p-4">
          {officialSelected ? (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm font-medium text-ink">
                <Lock className="size-4" />
                {officialSelected.label}
              </p>
              <p className="text-sm text-muted">{OFFICIAL_LOCK_TOOLTIP}</p>
            </div>
          ) : selectedEl && selectedMerchant ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-ink">{MERCHANT_ELEMENT_LABELS[selectedMerchant]}</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>X</Label>
                  <Input
                    type="number"
                    value={Math.round(selectedEl.x)}
                    onChange={(event) => updateElement(selectedMerchant, { x: Number(event.target.value) })}
                  />
                </div>
                <div>
                  <Label>Y</Label>
                  <Input
                    type="number"
                    value={Math.round(selectedEl.y)}
                    onChange={(event) => updateElement(selectedMerchant, { y: Number(event.target.value) })}
                  />
                </div>
                <div>
                  <Label>Width</Label>
                  <Input
                    type="number"
                    value={Math.round(selectedEl.width)}
                    onChange={(event) => updateElement(selectedMerchant, { width: Number(event.target.value) })}
                  />
                </div>
                <div>
                  <Label>Height</Label>
                  <Input
                    type="number"
                    value={Math.round(selectedEl.height)}
                    onChange={(event) => updateElement(selectedMerchant, { height: Number(event.target.value) })}
                  />
                </div>
              </div>
              <div>
                <Label>Font size</Label>
                <Input
                  type="number"
                  value={selectedEl.fontSize ?? 9}
                  onChange={(event) => updateElement(selectedMerchant, { fontSize: Number(event.target.value) })}
                />
              </div>
              <div>
                <Label>Weight</Label>
                <Select
                  value={selectedEl.fontWeight ?? "normal"}
                  onValueChange={(value) =>
                    updateElement(selectedMerchant, { fontWeight: value as "normal" | "bold" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="bold">Bold</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Alignment</Label>
                <Select
                  value={selectedEl.align ?? "left"}
                  onValueChange={(value) =>
                    updateElement(selectedMerchant, { align: value as "left" | "center" | "right" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="center">Center</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Label>Visible</Label>
                <Switch
                  checked={Boolean(selectedEl.visible)}
                  onCheckedChange={(checked) => updateElement(selectedMerchant, { visible: checked })}
                />
              </div>
              {selectedMerchant === "products" ? (
                <div className="space-y-2">
                  {(["showName", "showSku", "showQuantity", "showPrice"] as const).map((key) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedEl[key] !== false && (key !== "showSku" || Boolean(selectedEl.showSku))}
                        onCheckedChange={(checked) => updateElement(selectedMerchant, { [key]: Boolean(checked) })}
                      />
                      {key.replace("show", "Show ")}
                    </label>
                  ))}
                </div>
              ) : null}
              {selectedMerchant === "customText" ||
              selectedMerchant === "promotionalMessage" ||
              selectedMerchant === "returnPolicy" ||
              selectedMerchant === "customerSupport" ? (
                <div>
                  <Label>Text</Label>
                  <Input
                    value={selectedEl.content ?? ""}
                    onChange={(event) => updateElement(selectedMerchant, { content: event.target.value })}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">Select an element to edit its position and type.</p>
          )}
        </aside>
      </div>

      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Print test</DialogTitle>
            <DialogDescription>
              Prints the packing label through the connected print agent at the size you choose. The official India Post PDF is not changed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Paper size</Label>
            <Select value={testSize} onValueChange={(value) => setTestSize(value as PaperSizeId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_PRESETS.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted">
              Station: {station.data?.connected ? "printer connected" : "printer offline — PDF will open if needed"}.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setPrintOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => printTest.mutate()} disabled={printTest.isPending}>
              Print test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
