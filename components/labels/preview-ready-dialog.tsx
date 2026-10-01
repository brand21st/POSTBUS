"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, Maximize2, Minimize2, Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Size = { w: number; h: number };
type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MIN_W = 480;
const MIN_H = 400;

function viewport() {
  return { vw: window.innerWidth, vh: window.innerHeight };
}

function clampSize(w: number, h: number): Size {
  const { vw, vh } = viewport();
  return {
    w: Math.min(Math.max(w, MIN_W), Math.max(MIN_W, vw - 24)),
    h: Math.min(Math.max(h, MIN_H), Math.max(MIN_H, vh - 24)),
  };
}

function defaultSize(): Size {
  const { vw, vh } = viewport();
  return clampSize(Math.min(920, vw - 56), Math.min(680, vh - 72));
}

function maxSize(): Size {
  const { vw, vh } = viewport();
  return clampSize(vw - 24, vh - 24);
}

function applyEdge(start: Size, edge: Edge, dx: number, dy: number): Size {
  let w = start.w;
  let h = start.h;
  if (edge.includes("e")) w += dx * 2;
  if (edge.includes("w")) w -= dx * 2;
  if (edge.includes("s")) h += dy * 2;
  if (edge.includes("n")) h -= dy * 2;
  return clampSize(w, h);
}

const EDGES: Array<{ edge: Edge; className: string; cursor: string }> = [
  { edge: "n", className: "inset-x-8 top-0 h-2", cursor: "ns-resize" },
  { edge: "s", className: "inset-x-8 bottom-0 h-2", cursor: "ns-resize" },
  { edge: "e", className: "inset-y-8 right-0 w-2", cursor: "ew-resize" },
  { edge: "w", className: "inset-y-8 left-0 w-2", cursor: "ew-resize" },
  { edge: "nw", className: "left-0 top-0 size-4", cursor: "nwse-resize" },
  { edge: "ne", className: "right-0 top-0 size-4", cursor: "nesw-resize" },
  { edge: "sw", className: "left-0 bottom-0 size-4", cursor: "nesw-resize" },
  { edge: "se", className: "right-0 bottom-0 size-4", cursor: "nwse-resize" },
];

function SheetSizeBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded bg-brand px-1.5 py-0.5 text-[10px] font-bold leading-none tracking-wide text-white",
        className
      )}
    >
      {label}
    </span>
  );
}

export const PreviewReadyDialog = memo(function PreviewReadyDialog({
  open,
  onOpenChange,
  previewUrl,
  sheetSize,
  onDownload,
  onPrint,
  printDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewUrl: string | null;
  sheetSize?: string | null;
  onDownload?: () => void;
  onPrint?: () => void;
  printDisabled?: boolean;
}) {
  const [size, setSize] = useState<Size | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const restore = useRef<Size | null>(null);
  const maximizedRef = useRef(false);
  const drag = useRef<{ edge: Edge; startX: number; startY: number; origin: Size } | null>(null);
  const moveFrame = useRef(0);
  const pendingSize = useRef<Size | null>(null);
  const onMoveRef = useRef<(event: PointerEvent) => void>(() => {});
  const onUpRef = useRef<() => void>(() => {});

  if (open && !size) {
    setSize(defaultSize());
  }

  const applyMaximized = (next: boolean) => {
    maximizedRef.current = next;
    setMaximized(next);
  };

  useEffect(() => {
    if (!open) return;
    const onWindowResize = () => {
      setSize((current) => {
        if (!current) return defaultSize();
        return maximizedRef.current ? maxSize() : clampSize(current.w, current.h);
      });
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [open]);

  const onWindowPointerMove = useCallback((event: PointerEvent) => {
    onMoveRef.current(event);
  }, []);

  const onWindowPointerUp = useCallback(() => {
    onUpRef.current();
  }, []);

  useEffect(() => {
    onMoveRef.current = (event: PointerEvent) => {
      const active = drag.current;
      if (!active) return;
      pendingSize.current = applyEdge(active.origin, active.edge, event.clientX - active.startX, event.clientY - active.startY);
      if (moveFrame.current) return;
      moveFrame.current = window.requestAnimationFrame(() => {
        moveFrame.current = 0;
        if (pendingSize.current) setSize(pendingSize.current);
      });
    };
    onUpRef.current = () => {
      if (moveFrame.current) {
        window.cancelAnimationFrame(moveFrame.current);
        moveFrame.current = 0;
      }
      if (pendingSize.current) setSize(pendingSize.current);
      pendingSize.current = null;
      drag.current = null;
      setDragging(false);
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
    };
  }, [onWindowPointerMove, onWindowPointerUp]);

  useEffect(
    () => () => {
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      if (moveFrame.current) window.cancelAnimationFrame(moveFrame.current);
    },
    [onWindowPointerMove, onWindowPointerUp]
  );

  const startDrag = (edge: Edge, event: React.PointerEvent) => {
    if (!size || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = { edge, startX: event.clientX, startY: event.clientY, origin: size };
    applyMaximized(false);
    setDragging(true);
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
  };

  const toggleMax = () => {
    if (maximized) {
      setSize(restore.current ?? defaultSize());
      applyMaximized(false);
      return;
    }
    if (size) restore.current = size;
    setSize(maxSize());
    applyMaximized(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-none max-w-none flex-col gap-0 overflow-hidden p-0 transition-none contain-layout"
        style={size ? { width: size.w, height: size.h } : undefined}
        onPointerDownOutside={(event) => {
          if (drag.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (drag.current) event.preventDefault();
        }}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="size-4" strokeWidth={2.5} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <DialogTitle className="text-sm font-semibold leading-tight">Preview Ready</DialogTitle>
              {sheetSize ? <SheetSizeBadge label={sheetSize} /> : null}
            </div>
            <DialogDescription className="text-xs">
              {size ? `${Math.round(size.w)} × ${Math.round(size.h)} · stays centered` : "Your sheet PDF is ready."}
            </DialogDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={toggleMax}
            aria-label={maximized ? "Restore size" : "Fill screen"}
            title={maximized ? "Restore size" : "Fill screen"}
          >
            {maximized ? <Minimize2 /> : <Maximize2 />}
          </Button>
          {onDownload ? (
            <Button type="button" variant="secondary" size="xs" onClick={onDownload}>
              <Download />
              Download
            </Button>
          ) : null}
          {onPrint ? (
            <Button type="button" variant="secondary" size="xs" onClick={onPrint} disabled={printDisabled}>
              <Printer />
              Print
            </Button>
          ) : null}
        </div>

        {previewUrl ? (
          <div className="relative min-h-0 flex-1">
            <iframe
              title="Sheet PDF preview"
              src={previewUrl}
              className={cn("h-full min-h-0 w-full bg-white [color-scheme:light]", dragging && "pointer-events-none")}
            />
            {sheetSize ? (
              <SheetSizeBadge
                label={sheetSize}
                className="pointer-events-none absolute bottom-3 left-3 z-10 shadow-sm"
              />
            ) : null}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">Building preview…</div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-1.5 flex justify-center">
          <span className="h-1 w-10 rounded-full bg-zinc-300/90 dark:bg-zinc-600" />
        </div>

        {EDGES.map((handle) => (
          <div
            key={handle.edge}
            role="separator"
            aria-orientation={handle.edge === "n" || handle.edge === "s" ? "horizontal" : "vertical"}
            aria-label={`Resize ${handle.edge}`}
            tabIndex={-1}
            className={cn("absolute z-20 touch-none", handle.className)}
            style={{ cursor: handle.cursor }}
            onPointerDown={(event) => startDrag(handle.edge, event)}
            onDoubleClick={(event) => {
              event.preventDefault();
              setSize(defaultSize());
              applyMaximized(false);
            }}
          />
        ))}
      </DialogContent>
    </Dialog>
  );
});
