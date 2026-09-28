import type { LabelLayout, LayoutBlock } from "@/modules/labels/layout/layout";
import { WATERMARK_ID } from "@/modules/labels/layout/layout";
import { entersPrinterMargin } from "@/modules/labels/collision";

export type LayoutWarning = {
  level: "info" | "warning";
  ids: string[];
  message: string;
};

function areaOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0.5 && height > 0.5;
}

function comparable(block: LayoutBlock) {
  return block.id !== WATERMARK_ID && block.kind !== "border";
}

export function validateLabel(layout: LabelLayout): LayoutWarning[] {
  const warnings: LayoutWarning[] = [];
  const page = layout.page;
  for (const block of layout.blocks) {
    if (block.id === WATERMARK_ID) continue;
    if (block.width <= 0 || block.height <= 0) {
      warnings.push({ level: "warning", ids: [block.id], message: `${block.id} has a zero or negative size.` });
    }
    if (block.x < -0.05 || block.y < -0.05 || block.x + block.width > page.widthPt + 0.05 || block.y + block.height > page.heightPt + 0.05) {
      warnings.push({ level: "warning", ids: [block.id], message: `${block.id} extends outside the page.` });
    } else if (block.kind !== "border" && entersPrinterMargin(block, page.widthPt, page.heightPt)) {
      warnings.push({ level: "warning", ids: [block.id], message: `${block.id} extends into the printer margin.` });
    }
    if (block.fontSize != null && (block.fontSize < 6 || block.fontSize > 36)) {
      warnings.push({ level: "warning", ids: [block.id], message: `${block.id} uses a font size outside 6–36 pt.` });
    }
    if (block.gap != null && (block.gap * 2 >= block.stored.width || block.gap * 2 >= block.stored.height) && block.stored.width > 0) {
      warnings.push({ level: "warning", ids: [block.id], message: `${block.id} padding consumes the block.` });
    }
    if (block.kind === "barcode" && block.barSlot && block.barSlot.height < 8) {
      warnings.push({ level: "warning", ids: [block.id], message: "The barcode frame is under 8 pt tall." });
    }
  }

  const blocks = layout.blocks.filter(comparable);
  for (let index = 0; index < blocks.length; index += 1) {
    for (let other = index + 1; other < blocks.length; other += 1) {
      const a = blocks[index];
      const b = blocks[other];
      if (!a || !b) continue;
      const storedHit = areaOverlap(a.stored, b.stored);
      const placedHit = areaOverlap(a, b);
      if (storedHit) {
        warnings.push({
          level: "info",
          ids: [a.id, b.id],
          message: `${a.id} and ${b.id} overlap. They stay where you placed them.`,
        });
      } else if (placedHit) {
        warnings.push({
          level: "warning",
          ids: [a.id, b.id],
          message: `${a.id} and ${b.id} overlap after auto height. They were not moved.`,
        });
      }
    }
  }
  return warnings;
}
