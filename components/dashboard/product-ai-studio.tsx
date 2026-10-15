"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, WandSparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";

const PROMPT_MAX = 500;

const PRESETS = [
  ["clean_ecommerce", "Clean eCommerce"],
  ["luxury_studio", "Luxury Studio"],
  ["lifestyle", "Lifestyle"],
  ["minimal_premium", "Minimal Premium"],
  ["social", "Social Media"],
  ["marketplace", "Marketplace"],
  ["festival", "Festival Campaign"],
  ["custom", "Custom AI Edit"],
] as const;

const ASPECTS = ["1:1", "4:5", "9:16", "16:9"] as const;
const ROLES = [
  ["main", "Main product"],
  ["gallery", "Gallery"],
  ["lifestyle", "Lifestyle"],
  ["feature", "Feature"],
  ["offer", "Offer poster"],
  ["social", "Social ad"],
  ["banner", "Banner"],
] as const;
const FESTIVALS = ["onam", "diwali", "christmas", "new_year", "eid", "custom"] as const;

type Quote = {
  enabled: boolean;
  creditCost: number;
  maxVariations: number;
  warning: string;
};

type Asset = { id: string; kind: string; url: string | null; selected_for_gallery?: boolean };
type JobView = { id: string; status: string; error_message?: string | null; credit_qty?: number; assets?: Asset[] };

export function ProductAiStudioLauncher({
  files,
  urls,
  productId,
  productName,
  price,
  compareAtPrice,
  categoryHint,
  disabled,
  onApplyFiles,
  onAttached,
}: {
  files: Array<File | null>;
  urls: Array<string | null>;
  productId?: string | null;
  productName?: string;
  price?: number;
  compareAtPrice?: number | null;
  categoryHint?: string;
  disabled?: boolean;
  onApplyFiles?: (files: File[]) => void;
  onAttached?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const quote = useQuery({
    queryKey: ["ai-image-quote"],
    queryFn: () => api<Quote>("/api/v1/products/ai-image/quote"),
  });

  if (!quote.data?.enabled) return null;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="xs"
          className="h-8 gap-1.5 bg-zinc-900 text-white hover:bg-zinc-800"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <Sparkles className="size-3.5" aria-hidden />
          Enhance with AI
        </Button>
        <p className="text-[11px] text-muted">Create professional product images. Optional — originals stay.</p>
      </div>
    );
  }

  return (
    <ProductAiStudioPanel
      files={files}
      urls={urls}
      productId={productId}
      productName={productName}
      price={price}
      compareAtPrice={compareAtPrice}
      categoryHint={categoryHint}
      quote={quote.data}
      quotePending={quote.isPending}
      onClose={() => setOpen(false)}
      onApplyFiles={onApplyFiles}
      onAttached={onAttached}
    />
  );
}

function ProductAiStudioPanel({
  files,
  urls,
  productId,
  productName,
  price,
  compareAtPrice,
  categoryHint,
  quote,
  quotePending,
  onClose,
  onApplyFiles,
  onAttached,
}: {
  files: Array<File | null>;
  urls: Array<string | null>;
  productId?: string | null;
  productName?: string;
  price?: number;
  compareAtPrice?: number | null;
  categoryHint?: string;
  quote?: Quote;
  quotePending: boolean;
  onClose: () => void;
  onApplyFiles?: (files: File[]) => void;
  onAttached?: () => void;
}) {
  const client = useQueryClient();
  const credits = useQuery({
    queryKey: ["ai-credits"],
    queryFn: () => api<{ remaining: number }>("/api/v1/ai-credits"),
  });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sources, setSources] = useState<Asset[]>([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [preset, setPreset] = useState<(typeof PRESETS)[number][0]>("clean_ecommerce");
  const [festival, setFestival] = useState<(typeof FESTIVALS)[number]>("onam");
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>("1:1");
  const [role, setRole] = useState<(typeof ROLES)[number][0]>("main");
  const [customPrompt, setCustomPrompt] = useState("");
  const [variations, setVariations] = useState(1);
  const [headline, setHeadline] = useState("SPECIAL OFFER");
  const [cta, setCta] = useState("SHOP NOW");
  const [job, setJob] = useState<JobView | null>(null);
  const [busy, setBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const previewUrl = useMemo(() => {
    const generated = job?.assets?.filter((asset) => asset.kind === "generated") ?? [];
    return generated[0]?.url ?? sources.find((item) => item.id === sourceId)?.url ?? sources[0]?.url ?? null;
  }, [job, sources, sourceId]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const started = await api<{
          session: { id: string };
          quote: Quote;
          creditsRemaining: number;
        }>("/api/v1/products/ai-image/sessions", {
          method: "POST",
          body: JSON.stringify({ productId: productId || undefined }),
        });
        if (cancelled) return;
        setSessionId(started.session.id);
        client.setQueryData(["ai-credits"], (current: { remaining: number } | undefined) =>
          current ? { ...current, remaining: started.creditsRemaining } : { remaining: started.creditsRemaining }
        );
        const uploaded: Asset[] = [];
        for (const [index, file] of files.entries()) {
          if (!file) continue;
          const form = new FormData();
          form.append("image", file);
          const asset = await api<Asset>(`/api/v1/products/ai-image/sessions/${started.session.id}/source`, {
            method: "POST",
            body: form,
          });
          uploaded.push(asset);
        }
        if (!uploaded.length) {
          for (const url of urls) {
            if (!url || url.startsWith("blob:")) continue;
            const blob = await fetch(url).then((response) => response.blob());
            const form = new FormData();
            form.append("image", new File([blob], "source.jpg", { type: blob.type || "image/jpeg" }));
            const asset = await api<Asset>(`/api/v1/products/ai-image/sessions/${started.session.id}/source`, {
              method: "POST",
              body: form,
            });
            uploaded.push(asset);
          }
        }
        if (!cancelled) {
          setSources(uploaded);
          setSourceId(uploaded[0]?.id ?? null);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not open Image Studio.");
        onClose();
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [client, files, onClose, productId, urls]);

  useEffect(() => {
    if (!job || (job.status !== "QUEUED" && job.status !== "RUNNING")) return;
    const timer = setInterval(() => {
      void api<JobView>(`/api/v1/products/ai-image/jobs/${job.id}`).then(setJob).catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (job?.status === "SUCCEEDED" || job?.status === "FAILED") setGenerating(false);
  }, [job?.status]);

  const cost = (quote?.creditCost ?? 10) * variations;
  const remaining = credits.data?.remaining ?? 0;
  const generated = job?.assets?.filter((asset) => asset.kind === "generated") ?? [];
  const imageBusy = generating || job?.status === "QUEUED" || job?.status === "RUNNING";

  async function enhancePrompt() {
    if (enhancing || remaining < 1) return;
    setEnhancing(true);
    try {
      const result = await api<{ prompt: string; creditsRemaining: number }>("/api/v1/products/ai-image/enhance-prompt", {
        method: "POST",
        body: JSON.stringify({
          prompt: customPrompt.trim().slice(0, PROMPT_MAX),
          preset,
          festival: preset === "festival" ? festival : undefined,
          aspect,
          role,
          productName: productName || undefined,
          categoryHint: categoryHint || undefined,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setCustomPrompt(result.prompt.slice(0, PROMPT_MAX));
      client.setQueryData(["ai-credits"], (current: { remaining: number } | undefined) =>
        current ? { ...current, remaining: result.creditsRemaining } : { remaining: result.creditsRemaining }
      );
      toast.success("Prompt enhanced. Review it, then generate.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not enhance the prompt.");
    } finally {
      setEnhancing(false);
    }
  }

  async function generate() {
    if (!sessionId || !sourceId) {
      toast.error("Upload a product photo first.");
      return;
    }
    setBusy(true);
    setGenerating(true);
    try {
      const created = await api<{ jobId: string; creditsRemaining: number }>("/api/v1/products/ai-image/jobs", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          sourceAssetId: sourceId,
          preset,
          festival: preset === "festival" ? festival : undefined,
          aspect,
          role,
          customPrompt: customPrompt || undefined,
          categoryHint: categoryHint || undefined,
          variationCount: variations,
          idempotencyKey: crypto.randomUUID(),
          offer:
            role === "offer"
              ? {
                  productName: productName || "Product",
                  pricePaise: Math.round((price ?? 0) * 100),
                  compareAtPaise: compareAtPrice != null ? Math.round(compareAtPrice * 100) : null,
                  headline,
                  cta,
                }
              : undefined,
        }),
      });
      client.setQueryData(["ai-credits"], (current: { remaining: number } | undefined) =>
        current ? { ...current, remaining: created.creditsRemaining } : { remaining: created.creditsRemaining }
      );
      setJob(await api<JobView>(`/api/v1/products/ai-image/jobs/${created.jobId}`));
    } catch (error) {
      setGenerating(false);
      toast.error(error instanceof Error ? error.message : "Could not generate.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    const ids = selected.length ? selected : generated.map((asset) => asset.id).slice(0, 3);
    if (!ids.length) {
      toast.error("Generate and select a photo first.");
      return;
    }
    setBusy(true);
    try {
      if (job) {
        await api(`/api/v1/products/ai-image/jobs/${job.id}/select`, {
          method: "POST",
          body: JSON.stringify({ assetIds: ids }),
        });
      }
      if (productId && sessionId) {
        await api("/api/v1/products/ai-image/attach", {
          method: "POST",
          body: JSON.stringify({ sessionId, productId, assetIds: ids }),
        });
        onAttached?.();
        toast.success("Saved to product photos. Originals are still in the studio.");
        onClose();
        return;
      }
      const picked = generated.filter((asset) => ids.includes(asset.id) && asset.url);
      const nextFiles: File[] = [];
      for (const asset of picked) {
        const blob = await fetch(asset.url!).then((response) => response.blob());
        nextFiles.push(new File([blob], `ai-${asset.id.slice(0, 6)}.png`, { type: "image/png" }));
      }
      onApplyFiles?.(nextFiles);
      toast.success("Added to product photos. Save the product when you are ready.");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save photos.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex bg-zinc-950/40">
      <section className="ml-auto flex h-full w-full max-w-[1100px] flex-col bg-card shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">AI Image Studio</h2>
            <p className="text-[11px] text-muted">Originals are kept. Check logos and colour before you save.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800">
              {remaining} credits
            </span>
            <Button type="button" size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close studio">
              <X className="size-4" />
            </Button>
          </div>
        </header>
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4 lg:grid-cols-[16rem_minmax(0,1fr)_16rem]">
          <aside className="space-y-3">
            <p className="text-xs font-semibold">Originals</p>
            <div className="grid grid-cols-3 gap-1.5">
              {sources.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => setSourceId(asset.id)}
                  className={cn("overflow-hidden rounded-lg border", sourceId === asset.id ? "border-brand ring-2 ring-brand/30" : "border-border")}
                >
                  {asset.url ? <img src={asset.url} alt="" className="aspect-square object-cover" /> : null}
                </button>
              ))}
            </div>
            <div>
              <Label className="text-xs">Preset</Label>
              <div className="mt-1 flex flex-wrap gap-1">
                {PRESETS.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPreset(id)}
                    className={cn("rounded-full border px-2 py-1 text-[11px]", preset === id ? "border-brand bg-brand/10 font-semibold" : "border-border")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {preset === "festival" ? (
              <div className="flex flex-wrap gap-1">
                {FESTIVALS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={cn("rounded-full border px-2 py-1 text-[11px] capitalize", festival === item ? "border-brand bg-brand/10" : "border-border")}
                    onClick={() => setFestival(item)}
                  >
                    {item.replace("_", " ")}
                  </button>
                ))}
              </div>
            ) : null}
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="studio-prompt" className="text-xs">
                  Prompt
                </Label>
                <span className="text-[10px] tabular-nums text-muted">
                  {customPrompt.length}/{PROMPT_MAX}
                </span>
              </div>
              <Textarea
                id="studio-prompt"
                rows={4}
                maxLength={PROMPT_MAX}
                disabled={enhancing || imageBusy}
                className="mt-1 min-h-[96px] resize-y text-sm"
                placeholder="Warm gold light, keep the kasavu border sharp, cream backdrop…"
                value={customPrompt}
                onChange={(event) => setCustomPrompt(event.target.value.slice(0, PROMPT_MAX))}
              />
              <div className="mt-1.5 flex items-center gap-1.5">
                {remaining < 1 ? (
                  <Link
                    href="/dashboard/billing#ai-credits"
                    className="inline-flex h-8 items-center rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-[11px] font-semibold text-rose-800"
                  >
                    Recharge to enhance
                  </Link>
                ) : (
                  <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    className="gap-1.5"
                    disabled={enhancing || imageBusy}
                    aria-busy={enhancing}
                    onClick={() => void enhancePrompt()}
                  >
                    {enhancing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <WandSparkles className="size-3.5" aria-hidden />}
                    {enhancing ? "Enhancing…" : "Enhance prompt"}
                  </Button>
                )}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted">
                {enhancing ? "Rewriting your notes into a stronger photo instruction." : "1 credit. Optional — AI rewrites this for the image model."}
              </p>
            </div>
            <div>
              <Label className="text-xs">Output</Label>
              <div className="mt-1 flex flex-wrap gap-1">
                {ASPECTS.map((item) => (
                  <button key={item} type="button" className={cn("rounded-full border px-2 py-1 text-[11px]", aspect === item ? "border-brand bg-brand/10" : "border-border")} onClick={() => setAspect(item)}>
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Use as</Label>
              <div className="mt-1 flex flex-wrap gap-1">
                {ROLES.map(([id, label]) => (
                  <button key={id} type="button" className={cn("rounded-full border px-2 py-1 text-[11px]", role === id ? "border-brand bg-brand/10" : "border-border")} onClick={() => setRole(id)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {role === "offer" ? (
              <div className="grid grid-cols-2 gap-2">
                <input className="h-8 rounded-lg border border-border px-2 text-xs" value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="Headline" />
                <input className="h-8 rounded-lg border border-border px-2 text-xs" value={cta} onChange={(event) => setCta(event.target.value)} placeholder="CTA" />
              </div>
            ) : null}
          </aside>
          <div className="flex min-h-[16rem] flex-col">
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface-soft">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Preview"
                  className={cn("max-h-[70vh] max-w-full object-contain transition duration-300", imageBusy && "scale-[1.02] blur-[1px]")}
                />
              ) : (
                <p className="p-6 text-center text-sm text-muted">Upload a product photo, then generate.</p>
              )}
              {imageBusy ? (
                <div
                  className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-zinc-950/45 text-white backdrop-blur-[2px]"
                  role="status"
                  aria-live="polite"
                  aria-label="Generating image"
                >
                  <span className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-studio-shimmer motion-reduce:hidden" />
                  <span className="relative flex size-12 items-center justify-center rounded-full border border-white/30 bg-white/10">
                    <Loader2 className="size-6 animate-spin" aria-hidden />
                  </span>
                  <p className="relative text-sm font-semibold tracking-tight">Creating image…</p>
                  <p className="relative text-[11px] text-white/80">Original stays. This can take a few seconds.</p>
                </div>
              ) : null}
            </div>
            <p className="mt-2 text-[11px] text-amber-800">{quote?.warning}</p>
          </div>
          <aside className="space-y-3">
            <p className="text-xs font-semibold">Variations</p>
            <div className="grid grid-cols-2 gap-1.5">
              {generated.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() =>
                    setSelected((current) =>
                      current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id].slice(0, 3)
                    )
                  }
                  className={cn("relative overflow-hidden rounded-lg border", selected.includes(asset.id) ? "border-brand ring-2 ring-brand/30" : "border-border")}
                >
                  {asset.url ? <img src={asset.url} alt="" className="aspect-square object-cover" /> : null}
                </button>
              ))}
              {imageBusy
                ? Array.from({ length: Math.max(0, variations - generated.length) }).map((_, index) => (
                    <div
                      key={`pending-${index}`}
                      className="relative aspect-square overflow-hidden rounded-lg border border-border bg-surface-soft"
                      aria-hidden
                    >
                      <span className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-studio-shimmer motion-reduce:hidden" />
                    </div>
                  ))
                : null}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span>Count</span>
              {[1, 2, 3].filter((n) => n <= (quote?.maxVariations ?? 3)).map((n) => (
                <button key={n} type="button" className={cn("h-7 w-7 rounded-full border text-xs", variations === n ? "border-brand bg-brand/10" : "border-border")} onClick={() => setVariations(n)}>
                  {n}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">
              Cost: <span className="font-semibold text-ink">{cost} credits</span>
              {quotePending ? "…" : null}
            </p>
            {job?.status === "FAILED" ? <p className="text-xs text-error">{job.error_message || "Generation failed. Credits were returned."}</p> : null}
            {job?.status === "RUNNING" || job?.status === "QUEUED" ? (
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <Loader2 className="size-3.5 animate-spin" /> Generating…
              </p>
            ) : null}
            <Button type="button" size="xs" className="w-full" disabled={busy || imageBusy || !sourceId || remaining < cost} onClick={() => void generate()}>
              {imageBusy ? "Generating…" : busy ? "Working…" : "Generate image"}
            </Button>
            <Button type="button" size="xs" variant="secondary" className="w-full" disabled={busy || !generated.length} onClick={() => void apply()}>
              Save to product
            </Button>
          </aside>
        </div>
      </section>
    </div>
  );
}
