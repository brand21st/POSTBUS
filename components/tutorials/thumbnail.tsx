"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

export function TutorialThumbnail({
  src,
  alt,
  className,
  showPlay = true,
}: {
  src: string;
  alt: string;
  className?: string;
  showPlay?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div className={cn("relative overflow-hidden bg-zinc-900", className)}>
      {failed || !src ? (
        <div className="flex h-full min-h-[8rem] w-full items-center justify-center bg-zinc-800">
          <Play className="size-10 fill-white/70 text-white/70" />
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
      {showPlay ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-black/70 text-white shadow-lg">
            <Play className="size-5 fill-white" />
          </span>
        </span>
      ) : null}
    </div>
  );
}
