"use client";

import type { PointerEvent } from "react";
import type { LayoutBlock, LabelLayout } from "@/modules/labels/layout/layout";
import { WATERMARK_ID } from "@/modules/labels/layout/layout";
import { baselineOffset } from "@/modules/labels/layout/text";
import { cn } from "@/lib/utils";

const INK = "#121726";
const MUTED = "#474d57";

export function LabelLayoutPaint({
  layout,
  scale,
  selected,
  spaceHeld,
  panning,
  logoUrl,
  barcodeUrl,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onResizeStart,
}: {
  layout: LabelLayout;
  scale: number;
  selected: string;
  spaceHeld: boolean;
  panning: boolean;
  logoUrl?: string | null;
  barcodeUrl?: string | null;
  onPointerDown: (id: string, event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (id: string, event: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onResizeStart: (id: string, event: PointerEvent<HTMLElement>) => void;
}) {
  return (
    <>
      {layout.blocks.map((block) => (
        <LayoutBlockView
          key={block.id}
          block={block}
          scale={scale}
          selected={selected === block.id}
          spaceHeld={spaceHeld}
          panning={panning}
          logoUrl={logoUrl}
          barcodeUrl={barcodeUrl}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onResizeStart={onResizeStart}
        />
      ))}
    </>
  );
}

function LayoutBlockView({
  block,
  scale,
  selected,
  spaceHeld,
  panning,
  logoUrl,
  barcodeUrl,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onResizeStart,
}: {
  block: LayoutBlock;
  scale: number;
  selected: boolean;
  spaceHeld: boolean;
  panning: boolean;
  logoUrl?: string | null;
  barcodeUrl?: string | null;
  onPointerDown: (id: string, event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (id: string, event: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onResizeStart: (id: string, event: PointerEvent<HTMLElement>) => void;
}) {
  const interactive = block.id !== WATERMARK_ID && block.kind !== "border";
  const imageUrl = block.kind === "logo" ? logoUrl : block.kind === "barcode" ? barcodeUrl : null;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={cn("absolute", interactive && (spaceHeld || panning ? "cursor-grab" : "cursor-grab active:cursor-grabbing"))}
      style={{
        left: block.x * scale,
        top: block.y * scale,
        width: block.width * scale,
        height: block.height * scale,
        pointerEvents: interactive ? "auto" : "none",
        outline: selected ? "2px solid var(--brand)" : undefined,
        outlineOffset: 2,
        overflow: "hidden",
      }}
      onPointerDown={interactive ? (event) => onPointerDown(block.id, event) : undefined}
      onPointerMove={interactive ? (event) => onPointerMove(block.id, event) : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
    >
      {block.kind === "border" ? (
        <div className="pointer-events-none absolute inset-0 box-border border-neutral-900" style={{ borderWidth: (block.stroke ?? 1) * scale, borderStyle: "solid" }} />
      ) : null}
      {block.rules?.map((rule, index) => (
        <div
          key={`${block.id}-rule-${index}`}
          className="absolute bg-neutral-900"
          style={{
            left: (rule.x - block.x) * scale,
            top: (rule.y - block.y) * scale,
            width: rule.width * scale,
            height: Math.max(rule.height * scale, 0.5),
          }}
        />
      ))}
      {block.image && imageUrl ? (
        // The rectangle is the canonical fitted frame. The image must not choose its own size.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          src={imageUrl}
          style={{
            position: "absolute",
            left: (block.image.x - block.x) * scale,
            top: (block.image.y - block.y) * scale,
            width: block.image.width * scale,
            height: block.image.height * scale,
          }}
        />
      ) : null}
      {block.cells?.map((cell, index) => (
        <div
          key={`${block.id}-cell-${index}`}
          className="absolute box-border"
          style={{
            left: (cell.x - block.x) * scale,
            top: (cell.y - block.y) * scale,
            width: cell.width * scale,
            height: cell.height * scale,
            background: cell.header ? "#e6edf7" : undefined,
            borderWidth: 0.6 * scale,
            borderStyle: "solid",
            borderColor: "#bfc7d6",
          }}
        />
      ))}
      {block.lines.map((line, index) => (
        <LayoutLine key={`${block.id}-${index}`} line={line} block={block} scale={scale} color={block.kind === "watermark" ? MUTED : INK} />
      ))}
      {block.cells?.flatMap((cell, index) =>
        cell.lines.map((line, lineIndex) => (
          <LayoutLine key={`${block.id}-cell-line-${index}-${lineIndex}`} line={line} block={block} scale={scale} color={INK} />
        ))
      )}
      {selected && interactive ? (
        <button
          type="button"
          aria-label="Resize block"
          className="absolute bottom-0 right-0 size-3 cursor-se-resize bg-brand"
          onPointerDown={(event) => onResizeStart(block.id, event)}
          onPointerMove={(event) => onPointerMove(block.id, event)}
          onPointerUp={onPointerUp}
        />
      ) : null}
    </div>
  );
}

function LayoutLine({
  line,
  block,
  scale,
  color,
}: {
  line: LayoutBlock["lines"][number];
  block: LayoutBlock;
  scale: number;
  color: string;
}) {
  const top = (line.baseline - baselineOffset(line.fontSize) - block.y) * scale;
  return (
    <>
      {line.runs.map((run, index) => (
        <span
          key={`${run.x}-${index}`}
          className="label-layout-text absolute whitespace-pre"
          style={{
            left: (run.x - block.x) * scale,
            top,
            fontSize: line.fontSize * scale,
            lineHeight: `${line.fontSize * scale}px`,
            fontWeight: run.bold ? 700 : 400,
            fontStyle: run.italic ? "italic" : "normal",
            color,
          }}
        >
          {run.text}
        </span>
      ))}
    </>
  );
}
