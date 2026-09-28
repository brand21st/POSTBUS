import { ptFromMm } from "@/modules/labels/layout/units";

export type MultiUpRotation = 0 | 90;

export type MultiUpMargins = {
  topMm: number;
  rightMm: number;
  bottomMm: number;
  leftMm: number;
};

export type MultiUpGaps = {
  horizontalMm: number;
  verticalMm: number;
};

export type MultiUpCopy = {
  orderId: string;
  copies: number;
};

export type MultiUpInput = {
  sheetWidthMm: number;
  sheetHeightMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  margins: MultiUpMargins;
  gaps: MultiUpGaps;
  /** "auto" compares 0° and 90° and keeps the orientation that fits more slots. A tie stays at 0°. */
  rotation: MultiUpRotation | "auto";
  /** Physical scale of the whole label. Default 1. Auto fit does not change this. */
  scale?: number;
  /** When both are set, the grid is fixed and rejected if it does not fit. */
  columns?: number | null;
  rows?: number | null;
  items: MultiUpCopy[];
};

export type MultiUpPlacement = {
  index: number;
  orderId: string;
  page: number;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  rotation: MultiUpRotation;
};

export type MultiUpLayout = {
  ok: true;
  sheetWidthPt: number;
  sheetHeightPt: number;
  columns: number;
  rows: number;
  perSheet: number;
  rotation: MultiUpRotation;
  placements: MultiUpPlacement[];
};

export type MultiUpFailure = {
  ok: false;
  message: string;
};

const FIT_MESSAGE = "Label does not fit on the selected sheet with the current margins and spacing.";

function slotCount(available: number, label: number, gap: number) {
  if (!(label > 0) || !(available + 0.001 >= label)) return 0;
  return Math.floor((available + gap) / (label + gap));
}

function orientedSize(labelWidthMm: number, labelHeightMm: number, rotation: MultiUpRotation, scale: number) {
  const width = labelWidthMm * scale;
  const height = labelHeightMm * scale;
  return rotation === 90 ? { widthMm: height, heightMm: width } : { widthMm: width, heightMm: height };
}

function gridFor(
  input: MultiUpInput,
  rotation: MultiUpRotation,
  scale: number
): { columns: number; rows: number } | MultiUpFailure {
  const { widthMm, heightMm } = orientedSize(input.labelWidthMm, input.labelHeightMm, rotation, scale);
  const availableWidth = input.sheetWidthMm - input.margins.leftMm - input.margins.rightMm;
  const availableHeight = input.sheetHeightMm - input.margins.topMm - input.margins.bottomMm;
  const fittedColumns = slotCount(availableWidth, widthMm, input.gaps.horizontalMm);
  const fittedRows = slotCount(availableHeight, heightMm, input.gaps.verticalMm);
  const columns = input.columns ?? fittedColumns;
  const rows = input.rows ?? fittedRows;
  if (!(columns > 0) || !(rows > 0) || columns > fittedColumns || rows > fittedRows) {
    return { ok: false, message: FIT_MESSAGE };
  }
  return { columns, rows };
}

function expandItems(items: MultiUpCopy[]) {
  const orderIds: string[] = [];
  for (const item of items) {
    const copies = Math.max(0, Math.floor(item.copies));
    for (let copy = 0; copy < copies; copy += 1) orderIds.push(item.orderId);
  }
  return orderIds;
}

function invalid(input: MultiUpInput, scale: number): string | null {
  if (!(input.sheetWidthMm > 0) || !(input.sheetHeightMm > 0)) return "Sheet size must be greater than zero.";
  if (!(input.labelWidthMm > 0) || !(input.labelHeightMm > 0)) return "Label size must be greater than zero.";
  if (!(scale > 0)) return "Scale must be greater than zero.";
  const margins = [input.margins.topMm, input.margins.rightMm, input.margins.bottomMm, input.margins.leftMm];
  if (margins.some((value) => !(value >= 0))) return "Margins must be zero or greater.";
  if (!(input.gaps.horizontalMm >= 0) || !(input.gaps.verticalMm >= 0)) return "Gaps must be zero or greater.";
  if (input.rotation !== "auto" && input.rotation !== 0 && input.rotation !== 90) return "Rotation must be 0° or 90°.";
  return null;
}

/** Places finished labels on a sheet. Coordinates are top-left, Y down, in points. */
export function calculateMultiUpLayout(input: MultiUpInput): MultiUpLayout | MultiUpFailure {
  const scale = input.scale ?? 1;
  const problem = invalid(input, scale);
  if (problem) return { ok: false, message: problem };

  const rotation: MultiUpRotation =
    input.rotation === "auto" ? chooseRotation(input, scale) : input.rotation;
  const upright = rotationChoice(input, scale, 0);
  const turned = rotationChoice(input, scale, 90);
  if (input.rotation === "auto" && "ok" in upright && "ok" in turned) {
    return { ok: false, message: FIT_MESSAGE };
  }
  const grid = gridFor(input, rotation, scale);
  if ("ok" in grid) return grid;

  const { widthMm, heightMm } = orientedSize(input.labelWidthMm, input.labelHeightMm, rotation, scale);
  const orderIds = expandItems(input.items);
  const perSheet = grid.columns * grid.rows;
  const placements: MultiUpPlacement[] = orderIds.map((orderId, index) => {
    const slot = index % perSheet;
    const column = slot % grid.columns;
    const row = Math.floor(slot / grid.columns);
    const xMm = input.margins.leftMm + column * (widthMm + input.gaps.horizontalMm);
    const yMm = input.margins.topMm + row * (heightMm + input.gaps.verticalMm);
    return {
      index,
      orderId,
      page: Math.floor(index / perSheet),
      xPt: ptFromMm(xMm),
      yPt: ptFromMm(yMm),
      widthPt: ptFromMm(widthMm),
      heightPt: ptFromMm(heightMm),
      rotation,
    };
  });

  return {
    ok: true,
    sheetWidthPt: ptFromMm(input.sheetWidthMm),
    sheetHeightPt: ptFromMm(input.sheetHeightMm),
    columns: grid.columns,
    rows: grid.rows,
    perSheet,
    rotation,
    placements,
  };
}

function rotationChoice(input: MultiUpInput, scale: number, rotation: MultiUpRotation) {
  const fixed = { ...input, columns: null, rows: null };
  return gridFor(fixed, rotation, scale);
}

function chooseRotation(input: MultiUpInput, scale: number): MultiUpRotation {
  const upright = rotationChoice(input, scale, 0);
  const turned = rotationChoice(input, scale, 90);
  const uprightSlots = "ok" in upright ? 0 : upright.columns * upright.rows;
  const turnedSlots = "ok" in turned ? 0 : turned.columns * turned.rows;
  return turnedSlots > uprightSlots ? 90 : 0;
}
