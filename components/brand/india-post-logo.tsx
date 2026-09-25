import Image from "next/image";

import { cn } from "@/lib/utils";

export function IndiaPostLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/ind.jpg"
      alt="India Post"
      width={387}
      height={252}
      className={cn("h-12 w-auto max-w-[11rem] object-contain object-left", className)}
    />
  );
}
