import { cn } from "@/lib/utils";
import { HeroBadge } from "./hero-badge";
import { HeroHeadline } from "./hero-headline";
import { HeroCTA } from "./hero-cta";

export function HeroContent({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col space-y-6 sm:space-y-7", className)}>
      <HeroBadge />
      <HeroHeadline />
      <HeroCTA />
    </div>
  );
}
