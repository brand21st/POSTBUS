"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { productPhotosToAiDataUrls } from "@/lib/images/to-ai-data-url";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";

const MAX_PROMPT = 500;
const LOW_CREDITS = 25;

type CreditsResponse = {
  remaining: number;
  included?: number;
};

type CopyResponse = {
  title: string;
  description: string;
  creditsRemaining?: number;
};

export function ProductAiCopyBox({
  form,
  files,
  urls,
  disabled,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  files: Array<File | null>;
  urls: Array<string | null>;
  disabled?: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const queryClient = useQueryClient();
  const credits = useQuery({
    queryKey: ["ai-credits"],
    queryFn: () => api<CreditsResponse>("/api/v1/ai-credits"),
  });
  const included = credits.data?.included ?? 500;
  const remaining = credits.isSuccess ? credits.data.remaining : included;
  const outOfCredits = credits.isSuccess && remaining === 0;
  const hasPhotos = files.some(Boolean) || urls.some((url) => Boolean(url) && !url.startsWith("blob:"));
  const canGenerate = Boolean(prompt.trim() || hasPhotos || files.some(Boolean));

  async function generate() {
    if (inflight.current || disabled || outOfCredits || !canGenerate) return;
    const name = String(form.getValues("name") ?? "").trim();
    const description = String(form.getValues("description") ?? "").trim();
    if (name && description && !window.confirm("Replace the current title and description?")) return;
    inflight.current = true;
    setBusy(true);
    setHint(null);
    try {
      const images = await productPhotosToAiDataUrls(files, urls);
      const result = await api<CopyResponse>("/api/v1/products/ai-copy", {
        method: "POST",
        body: JSON.stringify({
          prompt: prompt.trim().slice(0, MAX_PROMPT),
          images,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      form.setValue("name", result.title, { shouldDirty: true, shouldValidate: true });
      form.setValue("description", result.description, { shouldDirty: true, shouldValidate: true });
      if (typeof result.creditsRemaining === "number") {
        queryClient.setQueryData(["ai-credits"], (current: CreditsResponse | undefined) =>
          current
            ? { ...current, remaining: result.creditsRemaining as number }
            : { remaining: result.creditsRemaining as number, included }
        );
      }
      setHint("Title and description filled. Review before saving.");
    } catch (error) {
      setHint(error instanceof Error ? error.message : "Could not generate copy.");
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2 rounded-xl border border-border bg-surface-soft/60 p-3" aria-labelledby="product-ai-copy-heading">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id="product-ai-copy-heading" className="text-sm font-semibold tracking-tight text-ink">
            Describe with AI
          </h3>
          <p className="mt-0.5 text-xs leading-snug text-muted">
            Short notes or photos — AI writes an SEO title and store description.
          </p>
        </div>
        {outOfCredits ? (
          <Link
            href="/dashboard/billing#ai-credits"
            className="flex shrink-0 items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-800"
          >
            Recharge
          </Link>
        ) : (
          <div
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full border px-2 py-1",
              remaining <= 20 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-100 bg-emerald-50 text-emerald-800"
            )}
            title={`${remaining} AI credits remaining`}
          >
            <Sparkles className="size-3 shrink-0" aria-hidden />
            <p className="text-[11px] font-semibold leading-none tabular-nums">{remaining}</p>
          </div>
        )}
      </div>
      <label className="sr-only" htmlFor="product-ai-prompt">
        Product notes for AI
      </label>
      <Textarea
        id="product-ai-prompt"
        value={prompt}
        maxLength={MAX_PROMPT}
        disabled={busy || disabled}
        rows={2}
        placeholder="Handloom cotton saree, Kozhikode, for weddings"
        className="min-h-[64px] resize-y bg-card py-2 text-sm shadow-none"
        onChange={(event) => {
          setPrompt(event.target.value.slice(0, MAX_PROMPT));
          setHint(null);
        }}
      />
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="xs"
          className={cn(
            "group min-w-0 flex-1 text-white shadow-sm transition-all duration-300 ease-out sm:flex-none sm:px-3 [&_svg]:size-3.5",
            "!bg-[#25D366] hover:!bg-[#20bd5a] hover:shadow-md active:scale-[0.98]"
          )}
          disabled={disabled || busy || outOfCredits || !canGenerate}
          aria-busy={busy}
          onClick={() => void generate()}
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles className="transition-transform duration-300 group-hover:rotate-12" aria-hidden />}
          <span className="truncate">{busy ? "Generating…" : "Generate title & description"}</span>
        </Button>
      </div>
      <p className="text-[11px] leading-snug text-muted" role={hint ? "status" : undefined} aria-live={hint ? "polite" : undefined}>
        {outOfCredits ? (
          <>
            You&apos;re out of AI Credits.{" "}
            <Link href="/dashboard/billing#ai-credits" className="font-medium text-brand underline-offset-2 hover:underline">
              Buy Credits
            </Link>
          </>
        ) : remaining <= LOW_CREDITS && credits.isSuccess ? (
          <>
            Only {remaining} AI Credits remaining. Photos improve the copy.
            {hint ? ` ${hint}` : ""}
          </>
        ) : (
          hint ?? (hasPhotos ? "1 credit. Photos are included when you generate." : "1 credit. Add photos for a stronger scan.")
        )}
      </p>
    </section>
  );
}
