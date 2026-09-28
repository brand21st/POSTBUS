import type { PointBox } from "@/modules/labels/layout/units";

export function insetBox(box: PointBox, gap = 0): PointBox {
  const pad = Math.max(0, gap);
  return {
    x: box.x + pad,
    y: box.y + pad,
    width: Math.max(0, box.width - pad * 2),
    height: Math.max(0, box.height - pad * 2),
  };
}

export function fitContain(
  frame: PointBox,
  image: { width: number; height: number },
  align: { x: "left" | "center" | "right"; y: "top" | "center" | "bottom" },
  upscale = true
): PointBox {
  if (!(image.width > 0) || !(image.height > 0) || !(frame.width > 0) || !(frame.height > 0)) {
    return { x: frame.x, y: frame.y, width: 0, height: 0 };
  }
  const scale = Math.min(frame.width / image.width, frame.height / image.height, upscale ? Number.POSITIVE_INFINITY : 1);
  const width = image.width * scale;
  const height = image.height * scale;
  let x = frame.x;
  let y = frame.y;
  if (align.x === "center") x = frame.x + (frame.width - width) / 2;
  if (align.x === "right") x = frame.x + frame.width - width;
  if (align.y === "center") y = frame.y + (frame.height - height) / 2;
  if (align.y === "bottom") y = frame.y + frame.height - height;
  return { x, y, width, height };
}
