import { HeroBackground } from "@/components/product-ui/hero-background";
import { HeroContent } from "./hero/hero-content";
import { HeroVisual } from "./hero/hero-visual";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-white pb-14 pt-8 sm:pb-16 sm:pt-12 lg:pb-20 lg:pt-10">
      <HeroBackground />
      <div className="relative grid items-start gap-8 xl:grid-cols-12 xl:items-center xl:gap-0">
        <div className="relative z-20 w-full px-5 sm:px-6 lg:px-8 xl:col-span-5 xl:pl-[max(1.25rem,calc((100vw-80rem)/2+2rem))] xl:pr-6">
          <HeroContent />
        </div>
        <div className="relative z-0 hidden min-w-0 xl:col-span-7 xl:block xl:h-[640px] xl:-ml-28 xl:w-[calc(100%+7rem)]">
          <HeroVisual />
        </div>
      </div>
    </section>
  );
}

export default Hero;
