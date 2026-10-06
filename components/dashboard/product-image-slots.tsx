"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Star, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const SLOT_LABELS = ["Cover", "Photo 2", "Photo 3"] as const;
const ACCEPT = "image/png,image/jpeg,image/webp";

export function ProductImageSlots({
  urls,
  disabled,
  busySlot,
  onPick,
  onRemove,
  onSetCover,
  onReorder,
}: {
  urls: Array<string | null>;
  disabled?: boolean;
  busySlot?: number | null;
  onPick: (slot: number, file: File) => void;
  onRemove: (slot: number) => void;
  onSetCover?: (slot: number) => void;
  onReorder?: (from: number, to: number) => void;
}) {
  const slots = [0, 1, 2] as const;
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);

  function takeFile(slot: number, file: File | undefined) {
    if (!file || disabled) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error("Upload a PNG, JPEG, or WebP photo.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Product photos must be 5 MB or smaller.");
      return;
    }
    onPick(slot, file);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Photos</p>
          <p className="text-xs text-muted">Up to 3 · recommended 1200 × 1200 px · drag to reorder · first photo is the cover.</p>
        </div>
        <p className="text-[11px] text-muted">{urls.filter(Boolean).length}/3</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {slots.map((slot) => {
          const url = urls[slot] ?? null;
          const busy = busySlot === slot;
          return (
            <ImageSlot
              key={slot}
              slot={slot}
              url={url}
              busy={busy}
              disabled={Boolean(disabled)}
              dragOver={dragOver === slot}
              onDragOverChange={(over) => setDragOver(over ? slot : null)}
              onFile={(file) => takeFile(slot, file)}
              onRemove={() => onRemove(slot)}
              onSetCover={slot > 0 && url && onSetCover ? () => onSetCover(slot) : undefined}
              draggable={Boolean(url && onReorder)}
              onDragStart={() => { dragFrom.current = slot; }}
              onReorder={() => {
                const from = dragFrom.current;
                dragFrom.current = null;
                if (from != null && from !== slot) onReorder?.(from, slot);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function ImageSlot({
  slot,
  url,
  busy,
  disabled,
  dragOver,
  onDragOverChange,
  onFile,
  onRemove,
  onSetCover,
  draggable,
  onDragStart,
  onReorder,
}: {
  slot: number;
  url: string | null;
  busy: boolean;
  disabled: boolean;
  dragOver: boolean;
  onDragOverChange: (over: boolean) => void;
  onFile: (file: File | undefined) => void;
  onRemove: () => void;
  onSetCover?: () => void;
  draggable: boolean;
  onDragStart: () => void;
  onReorder: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={cn(
        "group relative aspect-square overflow-hidden rounded-xl border border-dashed border-border bg-surface-soft/60 transition",
        url && "border-solid bg-card",
        dragOver && !disabled && "border-brand bg-brand/5",
        disabled && "opacity-70"
      )}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) onDragOverChange(true);
      }}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragLeave={() => onDragOverChange(false)}
      onDrop={(event) => {
        event.preventDefault();
        onDragOverChange(false);
        if (event.dataTransfer.files?.length) {
          onFile(event.dataTransfer.files[0]);
          return;
        }
        onReorder();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        disabled={disabled || busy}
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {url ? (
        // Product photos are merchant-owned uploads; next/image is not required here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          className="flex size-full flex-col items-center justify-center gap-1 px-2 text-center text-muted hover:text-ink"
        >
          <ImagePlus className="size-5" />
          <span className="text-[11px] font-medium leading-tight">{SLOT_LABELS[slot]}</span>
        </button>
      )}

      {url ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-1.5">
          <span className="rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {slot === 0 ? "Cover" : SLOT_LABELS[slot]}
          </span>
        </div>
      ) : null}

      {url && !disabled ? (
        <div className="absolute inset-0 flex items-end justify-center gap-1 bg-gradient-to-t from-black/70 via-black/10 to-transparent p-1.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            className="pointer-events-auto rounded-md bg-white/95 px-1.5 py-1 text-[10px] font-semibold text-ink hover:bg-white"
            onClick={() => inputRef.current?.click()}
          >
            Replace
          </button>
          {onSetCover ? (
            <button
              type="button"
              className="pointer-events-auto rounded-md bg-white/95 p-1 text-ink hover:bg-white"
              title="Use as cover"
              onClick={onSetCover}
            >
              <Star className="size-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            className="pointer-events-auto rounded-md bg-white/95 p-1 text-ink hover:bg-white"
            title="Remove photo"
            onClick={onRemove}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      {busy ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70">
          <Loader2 className="size-5 animate-spin text-brand" />
        </div>
      ) : null}
    </div>
  );
}

export function emptyPhotoSlots(): Array<string | null> {
  return [null, null, null];
}

export function padPhotoSlots(urls: string[] | null | undefined): Array<string | null> {
  return [urls?.[0] ?? null, urls?.[1] ?? null, urls?.[2] ?? null];
}
