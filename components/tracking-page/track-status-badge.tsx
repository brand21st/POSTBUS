import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TrackStatusTone } from "@/modules/tracking-pages/customer-track-view";

const TONE_CLASS: Record<TrackStatusTone, string> = {
  success: "border-transparent bg-emerald-100 text-emerald-800",
  primary: "border-transparent bg-rose-100 text-brand-dark",
  attention: "border-amber-200/80 bg-amber-100 text-amber-900",
  warning: "border-amber-200/80 bg-amber-100 text-amber-900",
  error: "border-transparent bg-red-100 text-red-800",
  neutral: "border-transparent bg-zinc-100 text-zinc-800",
};

export function TrackStatusBadge({
  label,
  tone,
  className,
}: {
  label: string;
  tone: TrackStatusTone;
  className?: string;
}) {
  return (
    <Badge className={cn("px-3 py-1 text-[11px] font-semibold uppercase tracking-wide", TONE_CLASS[tone], className)}>
      {label}
    </Badge>
  );
}
