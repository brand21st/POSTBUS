import { cn } from "@/lib/utils";

export function HeroBadge({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-full border border-brand/20 bg-brand/[0.06] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand sm:text-[11px]",
        className
      )}
    >
      <span className="relative flex size-2 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-brand" />
      </span>
      <span className="truncate sm:whitespace-normal">India Post shipping for ecommerce</span>
    </div>
  );
}
