import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTrackDateTime } from "@/modules/tracking-pages/customer-track-view";
import type { CustomerProgressStep } from "@/modules/tracking-pages/customer-track-view";

export function DeliveryProgress({
  steps,
  pulse,
}: {
  steps: CustomerProgressStep[];
  pulse: boolean;
}) {
  if (steps.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" aria-label="Delivery progress">
      <ol className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-0">
        {steps.map((step, index) => (
          <li
            key={step.stage}
            className="relative flex flex-1 items-start gap-3 md:flex-col md:items-center md:px-1"
            aria-current={step.current ? "step" : undefined}
          >
            {index < steps.length - 1 ? (
              <span
                className={cn(
                  "absolute left-[13px] top-8 h-[calc(100%-8px)] w-px md:left-[calc(50%+16px)] md:top-[13px] md:h-px md:w-[calc(100%-16px)]",
                  step.completed || step.current ? "bg-brand/40" : "bg-border"
                )}
                aria-hidden="true"
              />
            ) : null}
            <span
              className={cn(
                "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                step.completed && "border-brand bg-brand text-white",
                step.current && !step.completed && "border-brand bg-white text-brand",
                !step.completed && !step.current && "border-border bg-surface-soft text-muted"
              )}
            >
              {step.current && pulse ? (
                <span className="absolute inset-0 animate-ping rounded-full bg-brand/25" aria-hidden="true" />
              ) : null}
              {step.completed ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
              <span className="sr-only">
                {step.label}
                {step.current ? ", current stage" : step.completed ? ", completed" : ", upcoming"}
              </span>
            </span>
            <div className="min-w-0 md:text-center">
              <p
                className={cn(
                  "text-xs font-semibold uppercase tracking-wide",
                  step.current ? "text-ink" : step.completed ? "text-foreground" : "text-muted"
                )}
              >
                {step.label}
              </p>
              {step.completed && step.timestamp ? (
                <p className="mt-0.5 text-[11px] text-muted">{formatTrackDateTime(step.timestamp)}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
