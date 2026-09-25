import Image from "next/image";
import { cn } from "@/lib/utils";

export function HeroVisual({ className }: { className?: string }) {
  return (
    <div className={cn("relative hidden h-full min-h-[640px] w-full xl:block", className)}>
      <div
        className="pointer-events-none absolute -inset-8 bg-gradient-to-tr from-brand/10 via-rose-100/20 to-transparent opacity-70 blur-3xl"
        aria-hidden="true"
      />
      <Image
        src="/images/postbus-india-post-shipping-dashboard.webp"
        alt="PostBus dashboard with India Post Customer ID connected, shipment booking, label printing, tracking, and a delivered package"
        width={1400}
        height={700}
        loading="eager"
        fetchPriority="high"
        sizes="(min-width: 1280px) 58vw, 1px"
        className="select-none object-contain object-right xl:absolute xl:inset-0 xl:h-full xl:w-full xl:object-cover xl:object-[50%_center] xl:[mask-image:linear-gradient(to_right,transparent_0%,transparent_6%,rgba(0,0,0,0.55)_22%,black_48%)] xl:[-webkit-mask-image:linear-gradient(to_right,transparent_0%,transparent_6%,rgba(0,0,0,0.55)_22%,black_48%)]"
      />
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-[58%] bg-[linear-gradient(to_right,white_0%,white_12%,rgba(255,255,255,0.94)_28%,rgba(255,255,255,0.62)_48%,rgba(255,255,255,0.18)_70%,transparent_100%)] xl:block"
        aria-hidden="true"
      />
    </div>
  );
}
