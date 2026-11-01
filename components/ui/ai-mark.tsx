import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The PostBus AI mark: white sparkles on a rose → violet tile.
 * Use it wherever a suggestion or value comes from AI or AutoPack, so merchants can tell
 * machine suggestions apart from their own data at a glance.
 */
export function AiMark({ size = "md", className }: { size?: "xs" | "sm" | "md"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-gradient-to-br from-rose-500 via-fuchsia-500 to-violet-600 text-white shadow-sm ring-1 ring-white/30",
        size === "xs" && "size-4 rounded-[5px]",
        size === "sm" && "size-5 rounded-md",
        size === "md" && "size-8 rounded-lg",
        className
      )}
    >
      <Sparkles className={cn(size === "xs" ? "size-2.5" : size === "sm" ? "size-3" : "size-4")} strokeWidth={2.25} />
    </span>
  );
}

/** Small "AI" pill for labels and headings. */
export function AiPill({ label = "AI", className }: { label?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-rose-500/10 via-fuchsia-500/10 to-violet-600/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 ring-1 ring-violet-500/20 dark:text-violet-300",
        className
      )}
    >
      <Sparkles className="size-2.5" aria-hidden />
      {label}
    </span>
  );
}
