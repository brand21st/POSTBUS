"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export function LineItemThumb({
  title,
  imageUrl,
  className,
}: {
  title: string;
  imageUrl?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const letter = title.trim().charAt(0).toUpperCase() || "?";

  if (imageUrl && !failed) {
    return (
      // Shopify CDN URLs are unique per product; next/image is not required here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        className={cn("size-8 shrink-0 rounded-md bg-surface-soft object-cover", className)}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md bg-rose-100 text-xs font-semibold text-brand",
        className
      )}
    >
      {letter}
    </span>
  );
}
