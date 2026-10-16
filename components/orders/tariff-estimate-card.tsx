"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";
import { formatCurrency } from "@/lib/format";
import { tariffInputSchema, usableTariffDraft, type TariffQuote } from "@/modules/india-post/tariff-contract";

type Draft = { service?: string | null; destinationPincode?: string | null; weightGrams?: number; lengthCm?: number; widthCm?: number; heightCm?: number };
type Capabilities = { enabled: boolean; organizationId: string; senderChoices: Array<{ id: string; label: string; pincode: string }>; defaults?: Draft | null };
export type TariffEstimateStatus = { visible: boolean; text: string };
type Props = { orderId?: string; draft?: Draft; revision?: string; draftRevision?: string; onEstimate?: (status: TariffEstimateStatus) => void };

/** Inline estimate using the containing order form; no duplicate parcel controls. */
export function TariffEstimateCard({ onEstimate, ...props }: Props) {
  const me = useMe();
  const organizationId = me.data?.organization?.id;
  const capabilities = useQuery({
    queryKey: ["tariff-capabilities", organizationId, props.orderId, props.revision],
    queryFn: () => api<Capabilities>(`/api/v1/india-post/tariff-capabilities${props.orderId ? `?orderId=${encodeURIComponent(props.orderId)}` : ""}`, { cache: "no-store" }),
    enabled: Boolean(organizationId), retry: false,
  });
  const visible = Boolean(capabilities.data?.enabled && capabilities.data.organizationId === organizationId && !capabilities.isError);
  useEffect(() => {
    if (!visible) onEstimate?.({ visible: false, text: "—" });
  }, [onEstimate, visible]);
  if (!visible || !capabilities.data) return null;
  return <InlineEstimate {...props} onEstimate={onEstimate} capabilities={capabilities.data} />;
}

function InlineEstimate({ orderId, draft, revision, draftRevision, onEstimate, capabilities }: Props & { capabilities: Capabilities }) {
  const [sender, setSender] = useState("");
  const [result, setResult] = useState<{ key: string; quote?: TariffQuote; error?: string } | null>(null);
  const [loadingKey, setLoadingKey] = useState("");
  const busy = useRef(false);
  const lastStarted = useRef(0);
  const values = { ...capabilities.defaults, ...usableTariffDraft(draft) };
  const office = capabilities.senderChoices.length === 1 ? capabilities.senderChoices[0] : capabilities.senderChoices.find((choice) => choice.id === sender);
  const parsed = tariffInputSchema.safeParse({ ...values, sourcePincode: office?.pincode });
  const body = parsed.success ? {
    service: parsed.data.service, senderOffice: office?.id,
    weightGrams: parsed.data.weightGrams, lengthCm: parsed.data.lengthCm, widthCm: parsed.data.widthCm, heightCm: parsed.data.heightCm,
    ...(!orderId ? { destinationPincode: parsed.data.destinationPincode } : {}),
  } : null;
  const payload = body ? JSON.stringify(body) : null;
  const inputKey = JSON.stringify([capabilities.organizationId, orderId, values, sender, revision, draftRevision]);
  const [version, setVersion] = useState({ inputKey, number: 0 });
  if (version.inputKey !== inputKey) setVersion({ inputKey, number: version.number + 1 });
  const key = JSON.stringify([inputKey, version.number]);

  const previousService = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!payload) return;
    const switched = previousService.current !== undefined && previousService.current !== values.service;
    previousService.current = values.service == null ? undefined : String(values.service);
    let obsolete = false;
    const changedAt = Date.now();
    const timer = setInterval(() => {
      const settleMs = switched ? 0 : 800;
      const gapMs = switched ? 0 : 6500;
      if (busy.current || Date.now() - changedAt < settleMs || Date.now() - lastStarted.current < gapMs) return;
      clearInterval(timer);
      busy.current = true;
      lastStarted.current = Date.now();
      setLoadingKey(key);
      void api<TariffQuote>(orderId ? `/api/v1/orders/${encodeURIComponent(orderId)}/tariff-quote` : "/api/v1/india-post/tariff-quotes", { method: "POST", body: payload })
        .then((quote) => { if (!obsolete) setResult({ key, quote }); })
        .catch((error: unknown) => { if (!obsolete) setResult({ key, error: error instanceof Error ? error.message : "Shipping estimate is unavailable." }); })
        .finally(() => { busy.current = false; if (!obsolete) setLoadingKey(""); });
    }, 100);
    return () => { obsolete = true; clearInterval(timer); };
  }, [payload, key, orderId, values.service]);

  const current = result?.key === key ? result : null;
  const quote = current?.quote;
  const estimateText = quote ? formatCurrency(quote.estimatedTotal, "INR") : loadingKey === key ? "Calculating…" : payload && !current?.error ? "Updating…" : "—";
  useEffect(() => {
    onEstimate?.({ visible: true, text: estimateText });
  }, [estimateText, onEstimate]);
  return <div className="space-y-1.5 border-t border-border pt-3 text-sm" aria-label="Shipping tariff">
    {capabilities.senderChoices.length > 1 ? <label className="flex items-center justify-between gap-2 text-xs text-muted">Sender office
      <select aria-label="Tariff sender office" className="h-8 rounded border border-border bg-card px-2 text-ink" value={sender} onChange={(event) => setSender(event.target.value)}>
        <option value="">Choose office</option>{capabilities.senderChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label} · {choice.pincode}</option>)}
      </select>
    </label> : null}
    <div className="flex items-center justify-between gap-3" aria-live="polite">
      <span className="text-muted">Estimated shipping</span>
      <span className="font-medium tabular-nums">{estimateText}</span>
    </div>
    {!payload ? <p className="text-xs text-muted">{!office ? "Configure or select a sender office in India Post settings." : "Complete valid weight, dimensions, service and destination in the existing order fields to see the tariff."}</p> : null}
    {current?.error ? <p role="alert" className="text-xs text-muted">{current.error} Edit parcel details to calculate again.</p> : null}
    {quote ? <details className="text-xs text-muted"><summary className="cursor-pointer">Tariff breakdown</summary>
      <dl className="mt-2 space-y-1">{[
        ["Base tariff", quote.baseTariff], ["India Post COD service charge", quote.codCharges], ["CGST", quote.cgst], ["SGST", quote.sgst], ["Total tax", quote.totalTax],
        ...(typeof quote.vasCharges === "number" ? [["Value-added services", quote.vasCharges]] : Object.entries(quote.vasCharges ?? {}).map(([name, amount]) => [`Value-added service (${name})`, amount])),
      ].filter(([, amount]) => amount != null).map(([label, amount]) => <div className="flex justify-between gap-2" key={String(label)}><dt>{label}</dt><dd>{formatCurrency(Number(amount), "INR")}</dd></div>)}</dl>
      <p className="mt-2">Physical weight: {quote.physicalWeightGrams} g{quote.chargeableWeightGrams != null ? ` · Chargeable weight: ${quote.chargeableWeightGrams} g` : ""}. Final booking charges may differ; contract discounts are unverified.</p>
    </details> : null}
  </div>;
}
