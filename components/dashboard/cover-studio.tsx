"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, WandSparkles, X } from "lucide-react";
import { toast } from "sonner";
import { CoverHero } from "@/components/storefront/cover-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/hooks/use-api";
import {
  COVER_ENHANCE_ACTIONS,
  COVER_ENHANCE_LABELS,
  COVER_FESTIVAL_LABELS,
  COVER_FESTIVALS,
  COVER_PRESET_LABELS,
  COVER_PRESETS,
  COVER_TYPE_LABELS,
  COVER_TYPES,
  identityRiskForEnhance,
  type CoverEnhanceAction,
  type CoverFestival,
  type CoverPreset,
  type CoverType,
} from "@/modules/ai-image/cover-presets";
import { evaluateCoverChecks } from "@/modules/storefront/cover-checks";
import type { CoverRecord } from "@/modules/storefront/cover-model";
import { cn } from "@/lib/utils";

const STEPS = ["Type", "Images", "Preset", "Message", "Generate", "Preview", "Publish"] as const;

type Quote = { enabled: boolean; coverCreditCost?: number; creditCost: number; maxVariations: number };
type Asset = { id: string; kind: string; role?: string; url: string | null; storagePath?: string; storage_path?: string };
type JobView = { id: string; status: string; error_message?: string | null; assets?: Asset[] };

export function CoverStudio({
  coverId,
  initialType,
  initialPreset,
}: {
  coverId: string;
  initialType?: string;
  initialPreset?: string;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const isNew = coverId === "new";
  const coverQuery = useQuery({
    queryKey: ["inventory-cover", coverId],
    queryFn: () => api<CoverRecord>(`/api/v1/inventory/covers/${coverId}`),
    enabled: !isNew,
  });
  const credits = useQuery({
    queryKey: ["ai-credits"],
    queryFn: () => api<{ remaining: number }>("/api/v1/ai-credits"),
  });
  const quote = useQuery({
    queryKey: ["ai-image-quote"],
    queryFn: () => api<Quote>("/api/v1/products/ai-image/quote"),
  });
  const storefront = useQuery({
    queryKey: ["inventory-storefront"],
    queryFn: () =>
      api<{
        storePath?: string;
        logoUrl?: string | null;
        accentColor?: string;
        brandKit?: { secondaryColor?: string; tone?: string; ctaStyle?: string };
      }>("/api/v1/inventory/storefront"),
  });
  const [cover, setCover] = useState<Partial<CoverRecord>>({
    coverType: (COVER_TYPES.includes(initialType as CoverType) ? initialType : "homepage_hero") as CoverType,
    status: "DRAFT",
    enabled: false,
    textPosition: "left",
    overlayStrength: 40,
    textColor: "#ffffff",
    desktopFocal: { x: 50, y: 50 },
    mobileFocal: { x: 50, y: 50 },
    preset: initialPreset === "festival" ? "festival" : "luxury",
  });
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState<"desktop" | "mobile">("desktop");
  const [customPrompt, setCustomPrompt] = useState("");
  const [enhance, setEnhance] = useState<CoverEnhanceAction | null>(null);
  const [festival, setFestival] = useState<CoverFestival>("onam");
  const [history, setHistory] = useState<Partial<CoverRecord>[]>([]);
  const [future, setFuture] = useState<Partial<CoverRecord>[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [generating, setGenerating] = useState(false);
  const [enhancingCopy, setEnhancingCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ text: string; category: string }>>([]);
  const [variants, setVariants] = useState<Array<"desktop" | "mobile">>(["desktop", "mobile"]);
  const [variationCount, setVariationCount] = useState(1);

  useEffect(() => {
    if (coverQuery.data) {
      setCover(coverQuery.data);
      if (coverQuery.data.imageUrl) setOriginalUrl((current) => current ?? coverQuery.data.imageUrl);
    }
  }, [coverQuery.data]);

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

  function pushHistory(next: Partial<CoverRecord>) {
    setHistory((current) => [...current.slice(-19), cover]);
    setFuture([]);
    setCover((current) => ({ ...current, ...next }));
  }

  function undo() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((current) => current.slice(0, -1));
    setFuture((current) => [cover, ...current].slice(0, 20));
    setCover(previous);
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setFuture((current) => current.slice(1));
    setHistory((current) => [...current.slice(-19), cover]);
    setCover(next);
  }

  const cost = (quote.data?.coverCreditCost ?? quote.data?.creditCost ?? 10) * variationCount * variants.length;
  const remaining = credits.data?.remaining ?? 0;
  const generated = job?.assets?.filter((asset) => asset.kind === "generated") ?? [];
  const imageBusy = generating || job?.status === "QUEUED" || job?.status === "RUNNING";
  const previewSlide = {
    id: cover.id ?? "preview",
    imageUrl: (showOriginal ? originalUrl : cover.imageUrl) ?? originalUrl ?? "",
    mobileImageUrl: cover.mobileImageUrl ?? null,
    title: cover.title ?? null,
    subtitle: cover.subtitle ?? null,
    hook: cover.hook ?? null,
    ctaLabel: cover.ctaLabel ?? null,
    ctaHref: cover.ctaHref ?? null,
    offerBadge: cover.offerBadge ?? null,
    textPosition: cover.textPosition,
    overlayStrength: cover.overlayStrength,
    textColor: cover.textColor,
    desktopFocal: cover.desktopFocal,
    mobileFocal: cover.mobileFocal,
  };
  const checks = useMemo(
    () =>
      evaluateCoverChecks({
        title: cover.title,
        subtitle: cover.subtitle,
        hook: cover.hook,
        ctaLabel: cover.ctaLabel,
        ctaHref: cover.ctaHref,
        offerBadge: cover.offerBadge,
        discountPercent: cover.discountPercent,
        overlayStrength: cover.overlayStrength,
        textColor: cover.textColor,
        luminance: cover.luminance,
        mobileImageUrl: cover.mobileImageUrl,
        imageUrl: cover.imageUrl,
        desktopFocal: cover.desktopFocal,
        mobileFocal: cover.mobileFocal,
      }),
    [cover]
  );

  async function ensureCover(file?: File, kind: "desktop" | "mobile" = "desktop") {
    if (file) {
      const form = new FormData();
      form.append("image", file);
      form.append("kind", kind);
      if (isNew || !cover.id) {
        const created = await api<CoverRecord>("/api/v1/inventory/covers", { method: "POST", body: form });
        setCover(created);
        setOriginalUrl(created.imageUrl);
        router.replace(`/dashboard/inventory/covers/${created.id}`);
        return created;
      }
      const updated = await api<CoverRecord>(`/api/v1/inventory/covers/${cover.id}/image`, { method: "POST", body: form });
      setCover(updated);
      if (kind === "desktop") setOriginalUrl((current) => current ?? updated.imageUrl);
      return updated;
    }
    return cover as CoverRecord;
  }

  async function bootSession(file?: File, fromUrl?: string) {
    const started = await api<{ session: { id: string } }>("/api/v1/products/ai-image/sessions", {
      method: "POST",
      body: JSON.stringify({}),
    });
    setSessionId(started.session.id);
    const form = new FormData();
    if (file) form.append("image", file);
    else if (fromUrl) {
      const blob = await fetch(fromUrl).then((response) => response.blob());
      form.append("image", new File([blob], "source.jpg", { type: blob.type || "image/jpeg" }));
    } else {
      return { sessionId: started.session.id, sourceId: sourceId };
    }
    const asset = await api<Asset>(`/api/v1/products/ai-image/sessions/${started.session.id}/source`, {
      method: "POST",
      body: form,
    });
    setSourceId(asset.id);
    return { sessionId: started.session.id, sourceId: asset.id };
  }

  async function generate() {
    const current = cover.id ? cover : await ensureCover();
    if (!current?.imageUrl && !sourceId) {
      toast.error("Upload a source photo first.");
      return;
    }
    setBusy(true);
    setGenerating(true);
    try {
      const boot = sessionId && sourceId
        ? { sessionId, sourceId }
        : await bootSession(undefined, current?.imageUrl ?? originalUrl ?? undefined);
      if (!boot.sourceId) throw new Error("Upload a source photo first.");
      const created = await api<{ jobId: string; creditsRemaining: number; identityRisk?: boolean }>(
        "/api/v1/inventory/covers/jobs",
        {
          method: "POST",
          body: JSON.stringify({
            sessionId: boot.sessionId,
            sourceAssetId: boot.sourceId,
            coverId: current?.id,
            preset: cover.preset || "luxury",
            festival,
            enhance,
            coverType: cover.coverType,
            customPrompt: customPrompt || undefined,
            variants,
            variationCount,
            idempotencyKey: crypto.randomUUID(),
          }),
        }
      );
      if (created.identityRisk) {
        toast.message("This enhance can change the scene around the product. Check logos and packaging before you publish.");
      }
      client.setQueryData(["ai-credits"], (cur: { remaining: number } | undefined) =>
        cur ? { ...cur, remaining: created.creditsRemaining } : { remaining: created.creditsRemaining }
      );
      setJob(await api<JobView>(`/api/v1/products/ai-image/jobs/${created.jobId}`));
    } catch (error) {
      setGenerating(false);
      toast.error(error instanceof Error ? error.message : "Could not generate.");
    } finally {
      setBusy(false);
    }
  }

  async function applyAsset(asset: Asset) {
    if (!cover.id) return;
    const decoded = asset.storagePath || asset.storage_path;
    if (!decoded) return;
    const body =
      asset.role === "mobile"
        ? { mobileImagePath: decoded, aiAssetId: asset.id }
        : { desktopImagePath: decoded, aiAssetId: asset.id };
    const next = await api<CoverRecord>(`/api/v1/inventory/covers/${cover.id}/apply`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    pushHistory(next);
  }

  async function save(status?: "DRAFT" | "PUBLISHED") {
    if (!cover.id) {
      toast.error("Upload a photo first.");
      return;
    }
    setBusy(true);
    try {
      const next = await api<CoverRecord>(`/api/v1/inventory/covers/${cover.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: cover.name,
          title: cover.title,
          subtitle: cover.subtitle,
          hook: cover.hook,
          ctaLabel: cover.ctaLabel,
          ctaHref: cover.ctaHref,
          offerBadge: cover.offerBadge,
          discountPercent: cover.discountPercent,
          coverType: cover.coverType,
          textPosition: cover.textPosition,
          overlayStrength: cover.overlayStrength,
          textColor: cover.textColor,
          desktopFocal: cover.desktopFocal,
          mobileFocal: cover.mobileFocal,
          startsAt: cover.startsAt,
          endsAt: cover.endsAt,
          festival,
          preset: cover.preset,
          status: status ?? cover.status,
          enabled: status === "PUBLISHED" ? true : cover.enabled,
        }),
      });
      setCover(next);
      toast.success(status === "PUBLISHED" ? "Cover published." : "Draft saved.");
      if (status === "PUBLISHED") router.push("/dashboard/inventory?tab=covers");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function copyAction(action: "generate" | "more" | "rewrite" | "shorter" | "premium" | "emotional" | "direct" | "translate") {
    setEnhancingCopy(true);
    try {
      const result = await api<{
        headlines: Array<{ text: string; category: string }>;
        subheadline: string;
        hook: string;
        cta: string;
        creditsRemaining: number;
      }>("/api/v1/inventory/covers/ai-copy", {
        method: "POST",
        body: JSON.stringify({
          action,
          productName: cover.name,
          offer: cover.offerBadge,
          currentHeadline: cover.title,
          tone: "premium",
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setSuggestions(result.headlines);
      if (!cover.title && result.headlines[0]) pushHistory({ title: result.headlines[0].text, subtitle: result.subheadline, hook: result.hook, ctaLabel: result.cta });
      client.setQueryData(["ai-credits"], (cur: { remaining: number } | undefined) =>
        cur ? { ...cur, remaining: result.creditsRemaining } : { remaining: result.creditsRemaining }
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not write copy.");
    } finally {
      setEnhancingCopy(false);
    }
  }

  return (
    <div className="flex min-h-[80vh] flex-col rounded-2xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold">AI Cover Studio</h1>
          <p className="text-[11px] text-muted">Artwork is AI. Headline, offer, and CTA stay editable HTML.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800">
            {remaining} credits
          </span>
          <Button size="icon-xs" variant="ghost" aria-label="Close" onClick={() => router.push("/dashboard/inventory?tab=covers")}>
            <X className="size-4" />
          </Button>
        </div>
      </header>
      <nav className="flex flex-wrap gap-1 border-b border-border px-3 py-2" aria-label="Cover steps">
        {STEPS.map((label, index) => (
          <button
            key={label}
            type="button"
            className={cn("rounded-full px-2 py-1 text-[11px]", step === index ? "bg-brand/10 font-semibold text-brand" : "text-muted")}
            onClick={() => setStep(index)}
          >
            {index + 1}. {label}
          </button>
        ))}
      </nav>
      <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4 lg:grid-cols-[16rem_minmax(0,1fr)_16rem]">
        <aside className="space-y-3">
          <div>
            <Label className="text-xs">Cover type</Label>
            <div className="mt-1 flex flex-wrap gap-1">
              {COVER_TYPES.map((id) => (
                <button key={id} type="button" className={cn("rounded-full border px-2 py-1 text-[11px]", cover.coverType === id ? "border-brand bg-brand/10" : "border-border")} onClick={() => pushHistory({ coverType: id })}>
                  {COVER_TYPE_LABELS[id]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">Source images</Label>
            <Input
              className="mt-1"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void ensureCover(file, "desktop")
                  .then((created) => bootSession(file, created?.imageUrl))
                  .catch((error: Error) => toast.error(error.message));
              }}
            />
            <Input className="mt-1" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Mobile image" onChange={(event) => void ensureCover(event.target.files?.[0], "mobile").catch((error: Error) => toast.error(error.message))} />
            <p className="mt-1 text-[11px] text-muted">Desktop then mobile. Originals are never overwritten.</p>
          </div>
          <div>
            <Label className="text-xs">Preset</Label>
            <div className="mt-1 flex flex-wrap gap-1">
              {COVER_PRESETS.map((id) => (
                <button key={id} type="button" className={cn("rounded-full border px-2 py-1 text-[11px]", cover.preset === id ? "border-brand bg-brand/10" : "border-border")} onClick={() => pushHistory({ preset: id })}>
                  {COVER_PRESET_LABELS[id]}
                </button>
              ))}
            </div>
          </div>
          {cover.preset === "festival" || cover.coverType === "festival_offer" ? (
            <div className="flex flex-wrap gap-1">
              {COVER_FESTIVALS.map((id) => (
                <button key={id} type="button" className={cn("rounded-full border px-2 py-1 text-[11px]", festival === id ? "border-brand bg-brand/10" : "border-border")} onClick={() => setFestival(id)}>
                  {COVER_FESTIVAL_LABELS[id]}
                </button>
              ))}
            </div>
          ) : null}
          <div>
            <Label className="text-xs">Enhance</Label>
            <div className="mt-1 flex flex-wrap gap-1">
              {COVER_ENHANCE_ACTIONS.map((id) => (
                <button key={id} type="button" className={cn("rounded-full border px-2 py-1 text-[11px]", enhance === id ? "border-brand bg-brand/10" : "border-border")} onClick={() => setEnhance(enhance === id ? null : id)}>
                  {COVER_ENHANCE_LABELS[id]}
                </button>
              ))}
            </div>
            {identityRiskForEnhance(enhance) ? (
              <p className="mt-1 text-[11px] text-amber-800">This can change background objects. Check product identity before saving.</p>
            ) : null}
          </div>
          <Textarea rows={3} className="text-sm" placeholder="Custom art direction" value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} />
          <div className="rounded-lg border border-border p-2">
            <p className="text-[11px] font-semibold">Brand kit</p>
            <p className="mt-1 text-[11px] text-muted">Logo and primary colour come from Storefront. Tone and secondary colour stay here.</p>
            <div className="mt-2 flex items-center gap-2">
              {storefront.data?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={storefront.data.logoUrl} alt="" className="size-8 rounded object-contain" />
              ) : null}
              <span className="size-5 rounded-full border" style={{ background: storefront.data?.accentColor ?? "#e11d48" }} />
              <span className="text-[11px]">{storefront.data?.brandKit?.tone ?? "premium"}</span>
            </div>
          </div>
          <div>
            <Label className="text-xs">Layout</Label>
            <div className="mt-1 flex gap-1">
              {(["left", "center", "right"] as const).map((id) => (
                <button key={id} type="button" className={cn("rounded-full border px-2 py-1 text-[11px] capitalize", cover.textPosition === id ? "border-brand bg-brand/10" : "border-border")} onClick={() => pushHistory({ textPosition: id })}>
                  {id}
                </button>
              ))}
            </div>
            <Label className="mt-2 text-xs">Overlay {cover.overlayStrength}</Label>
            <input type="range" min={0} max={80} value={cover.overlayStrength ?? 40} onChange={(event) => pushHistory({ overlayStrength: Number(event.target.value) })} className="w-full" />
          </div>
        </aside>
        <div className="flex min-h-[16rem] flex-col">
          <div className="mb-2 flex items-center gap-2 text-xs">
            <button type="button" className={cn("rounded-full border px-2 py-1", preview === "desktop" ? "border-brand bg-brand/10" : "border-border")} onClick={() => setPreview("desktop")}>
              Desktop
            </button>
            <button type="button" className={cn("rounded-full border px-2 py-1", preview === "mobile" ? "border-brand bg-brand/10" : "border-border")} onClick={() => setPreview("mobile")}>
              Mobile
            </button>
            <button type="button" className="rounded-full border border-border px-2 py-1" onClick={() => setShowOriginal((current) => !current)}>
              {showOriginal ? "Show AI" : "Before / after"}
            </button>
            <Button size="xs" variant="ghost" disabled={!history.length} onClick={undo}>
              Undo
            </Button>
            <Button size="xs" variant="ghost" disabled={!future.length} onClick={redo}>
              Redo
            </Button>
          </div>
          <div
            className={cn("relative overflow-hidden rounded-2xl border border-border bg-surface-soft", preview === "mobile" ? "mx-auto aspect-[4/5] w-[min(100%,20rem)]" : "aspect-[16/9]")}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const x = Math.round(((event.clientX - rect.left) / rect.width) * 100);
              const y = Math.round(((event.clientY - rect.top) / rect.height) * 100);
              if (preview === "mobile") pushHistory({ mobileFocal: { x, y } });
              else pushHistory({ desktopFocal: { x, y } });
            }}
          >
            {previewSlide.imageUrl ? (
              <CoverHero slide={previewSlide} preview={preview} showGuides preload />
            ) : (
              <p className="flex h-full items-center justify-center p-6 text-sm text-muted">Upload a product or banner photo.</p>
            )}
            {imageBusy ? (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-zinc-950/45 text-white" role="status">
                <span className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-studio-shimmer motion-reduce:hidden" />
                <Loader2 className="relative size-6 animate-spin" />
                <p className="relative text-sm font-semibold">Creating cover…</p>
              </div>
            ) : null}
          </div>
          {generated.length ? (
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {generated.map((asset) => (
                <button key={asset.id} type="button" className="overflow-hidden rounded-lg border border-border" onClick={() => void applyAsset(asset)}>
                  {asset.url ? <img src={asset.url} alt="" className="aspect-video object-cover" /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <aside className="space-y-2">
          <Input placeholder="Internal name" value={cover.name ?? ""} onChange={(event) => pushHistory({ name: event.target.value })} />
          <Input placeholder="Headline" value={cover.title ?? ""} onChange={(event) => pushHistory({ title: event.target.value })} />
          <Input placeholder="Subheadline" value={cover.subtitle ?? ""} onChange={(event) => pushHistory({ subtitle: event.target.value })} />
          <Input placeholder="Selling hook" value={cover.hook ?? ""} onChange={(event) => pushHistory({ hook: event.target.value })} />
          <Input placeholder="CTA label" value={cover.ctaLabel ?? ""} onChange={(event) => pushHistory({ ctaLabel: event.target.value })} />
          <select
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs"
            value={cover.ctaHref === storefront.data?.storePath ? "home" : cover.ctaHref?.startsWith("https://") ? "https" : "custom"}
            onChange={(event) => {
              if (event.target.value === "home" && storefront.data?.storePath) pushHistory({ ctaHref: storefront.data.storePath });
              else if (event.target.value === "https") pushHistory({ ctaHref: cover.ctaHref?.startsWith("https://") ? cover.ctaHref : "https://" });
            }}
            aria-label="CTA destination"
          >
            <option value="home">Store home</option>
            <option value="custom">Store path / category / product</option>
            <option value="https">Custom https link</option>
          </select>
          <Input placeholder="CTA destination /store/… or https://" value={cover.ctaHref ?? ""} onChange={(event) => pushHistory({ ctaHref: event.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Offer badge" value={cover.offerBadge ?? ""} onChange={(event) => pushHistory({ offerBadge: event.target.value })} />
            <Input type="number" min={0} max={90} placeholder="Discount %" value={cover.discountPercent ?? ""} onChange={(event) => pushHistory({ discountPercent: event.target.value === "" ? null : Number(event.target.value) })} />
          </div>
          <div className="flex flex-wrap gap-1">
            {(["generate", "shorter", "premium", "emotional", "direct", "translate"] as const).map((action) => (
              <Button key={action} type="button" size="xs" variant="secondary" disabled={enhancingCopy || remaining < 1} onClick={() => void copyAction(action)}>
                {enhancingCopy ? <Loader2 className="size-3 animate-spin" /> : <WandSparkles className="size-3" />}
                {action}
              </Button>
            ))}
          </div>
          {suggestions.map((item) => (
            <button key={item.text} type="button" className="block w-full rounded-lg border border-border px-2 py-1 text-left text-[11px]" onClick={() => pushHistory({ title: item.text })}>
              <span className="font-semibold">{item.category}:</span> {item.text}
            </button>
          ))}
          <p className="text-xs font-semibold">CRO checklist</p>
          <ul className="space-y-1 text-[11px]">
            {checks.map((check) => (
              <li key={check.id} className={check.ok ? "text-emerald-800" : "text-amber-800"}>
                {check.ok ? "✓" : "•"} {check.label}
                {check.hint ? ` — ${check.hint}` : ""}
              </li>
            ))}
          </ul>
          <Label className="text-xs">Schedule start</Label>
          <Input type="datetime-local" value={cover.startsAt ? cover.startsAt.slice(0, 16) : ""} onChange={(event) => pushHistory({ startsAt: event.target.value ? new Date(event.target.value).toISOString() : null })} />
          <Label className="text-xs">Schedule end</Label>
          <Input type="datetime-local" value={cover.endsAt ? cover.endsAt.slice(0, 16) : ""} onChange={(event) => pushHistory({ endsAt: event.target.value ? new Date(event.target.value).toISOString() : null })} />
        </aside>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
        <p className="text-xs text-muted">
          Cost {cost} credits · {variants.join(" + ")} · {variationCount} variation{variationCount > 1 ? "s" : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1 text-xs">
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" className={cn("h-7 w-7 rounded-full border", variationCount === n ? "border-brand bg-brand/10" : "border-border")} onClick={() => setVariationCount(n)}>
                {n}
              </button>
            ))}
          </div>
          <Button size="xs" variant="secondary" disabled={busy} onClick={() => void save("DRAFT")}>
            Save draft
          </Button>
          <Button size="xs" disabled={busy || imageBusy || remaining < cost || !quote.data?.enabled} onClick={() => void generate()}>
            {imageBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {imageBusy ? "Generating…" : "Generate"}
          </Button>
          <Button size="xs" variant="secondary" disabled={busy || !cover.id} onClick={() => void save("PUBLISHED")}>
            Publish
          </Button>
        </div>
      </footer>
    </div>
  );
}
