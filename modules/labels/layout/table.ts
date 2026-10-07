import { measurePaintText } from "@/modules/labels/unicode/paint";
import { lineStep, placeLines, wrapText, type PlacedLine, type TextRun } from "@/modules/labels/layout/text";
import type { PointBox } from "@/modules/labels/layout/units";
import { PRODUCT_COLUMN_FLEX, type ProductColumnId, type ProductTable } from "@/modules/labels/custom-blocks";

export const TABLE_CELL_PAD = 3;
export const TABLE_BORDER = 0.6;
export const TABLE_ROW_PAD = 1;

export type TableCell = {
  x: number;
  y: number;
  width: number;
  height: number;
  header: boolean;
  bold: boolean;
  lines: PlacedLine[];
};

export function columnWidths(columns: Array<{ id: ProductColumnId }>, innerWidth: number) {
  const flexSum = columns.reduce((sum, column) => sum + PRODUCT_COLUMN_FLEX[column.id], 0) || 1;
  return columns.map((column) => (innerWidth * PRODUCT_COLUMN_FLEX[column.id]) / flexSum);
}

export function layoutTableGrid(input: {
  table: ProductTable;
  frame: PointBox;
  fontSize: number;
  extra: number;
  clip: PointBox;
}): { contentHeight: number; cells: TableCell[]; columnWidths: number[] } {
  const widths = columnWidths(input.table.columns, input.frame.width);
  const step = lineStep(input.fontSize, input.extra);
  const wrapped = [
    input.table.columns.map((column, index) =>
      wrapText(column.label, Math.max(0, (widths[index] ?? input.frame.width) - TABLE_CELL_PAD * 2), (text) =>
        measurePaintText(text, input.fontSize, "bold")
      )
    ),
    ...input.table.rows.map((row) =>
      row.cells.map((cell, index) =>
        wrapText(cell, Math.max(0, (widths[index] ?? input.frame.width) - TABLE_CELL_PAD * 2), (text) =>
          measurePaintText(text, input.fontSize, row.bold ? "bold" : "normal")
        )
      )
    ),
  ];
  const heights = wrapped.map((cells) => Math.max(1, ...cells.map((lines) => Math.max(1, lines.length))) * step + TABLE_ROW_PAD);
  const contentHeight = heights.reduce((sum, height) => sum + height, 0);
  const cells: TableCell[] = [];
  let y = input.frame.y;
  wrapped.forEach((row, rowIndex) => {
    const height = heights[rowIndex] ?? step + TABLE_ROW_PAD;
    if (y > input.clip.y + input.clip.height + 0.5) return;
    let x = input.frame.x;
    const header = rowIndex === 0;
    const bold = header || Boolean(input.table.rows[rowIndex - 1]?.bold);
    row.forEach((lines, columnIndex) => {
      const width = widths[columnIndex] ?? 0;
      const textBox = {
        x: x + TABLE_CELL_PAD,
        y,
        width: Math.max(0, width - TABLE_CELL_PAD * 2),
        height,
      };
      const runs: TextRun[][] = lines.map((line) => [{ text: line, bold, italic: false }]);
      cells.push({
        x,
        y,
        width,
        height,
        header,
        bold,
        lines: placeLines({
          lines: runs,
          box: textBox,
          align: "left",
          fontSize: input.fontSize,
          extra: input.extra,
          clip: input.clip,
          measure: (text, run) => measurePaintText(text, input.fontSize, run.bold ? "bold" : "normal", run.italic),
        }),
      });
      x += width;
    });
    y += height;
  });
  return { contentHeight, cells, columnWidths: widths };
}
