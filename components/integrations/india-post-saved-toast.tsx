"use client";

import { toast } from "sonner";
import { Check } from "lucide-react";

function playSaveChime() {
  if (typeof window === "undefined" || document.hidden) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const AudioCtx =
    window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  for (const [freq, start] of [
    [880, 0],
    [1320, 0.07],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(now + start);
    osc.stop(now + start + 0.16);
  }
  window.setTimeout(() => {
    void ctx.close();
  }, 400);
}

export function notifyIndiaPostSaved() {
  playSaveChime();
  toast.custom(
    () => (
      <div className="flex min-w-[16rem] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-lg">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-white motion-safe:animate-[save-pop_0.35s_ease-out]">
          <Check className="size-5" strokeWidth={2.5} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Saved successfully</p>
          <p className="text-xs text-muted">India Post settings saved.</p>
        </div>
      </div>
    ),
    { duration: 2800 }
  );
}
