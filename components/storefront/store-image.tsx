"use client";

import Image from "next/image";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

export function StoreImage({
  src,
  alt,
  sizes,
  className,
  preload = false,
}: {
  src?: string | null;
  alt: string;
  sizes: string;
  className?: string;
  preload?: boolean;
}) {
  if (!src) {
    return (
      <span className="flex size-full items-center justify-center bg-zinc-100 text-zinc-300" aria-hidden>
        <Package className="size-8" strokeWidth={1.5} />
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      preload={preload}
      loading={preload ? undefined : "lazy"}
      className={cn("object-cover", className)}
    />
  );
}
