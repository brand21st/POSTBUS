import { cn } from "@/lib/utils";

export function HeroHeadline({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-4 sm:space-y-5", className)}>
      <h1 className="text-balance text-3xl font-extrabold tracking-tight text-ink sm:text-4xl md:text-5xl lg:text-[54px] lg:leading-[1.08]">
        Already Shipping with <span className="text-brand">India Post</span>?
        <br className="hidden sm:inline" /> Ship Smarter with{" "}
        <span className="text-brand">PostBus</span>.
      </h1>
      <p className="max-w-xl text-pretty text-sm leading-relaxed text-zinc-600 sm:text-base md:text-lg">
        Connect your existing{" "}
        <strong className="font-semibold text-ink">India Post Customer ID</strong> and
        manage orders, shipping labels, tracking and invoices from one simple dashboard.
      </p>
    </div>
  );
}
