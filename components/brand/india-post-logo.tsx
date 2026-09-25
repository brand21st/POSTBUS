import Image from "next/image";

import { cn } from "@/lib/utils";

export function IndiaPostLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/ind.jpg"
      alt="India Post"
      width={120}
      height={48}
      className={cn("h-6 w-auto object-contain object-left", className)}
    />
  );
}
