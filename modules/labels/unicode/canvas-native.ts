import { createRequire } from "node:module";
import type { SKRSContext2D } from "@napi-rs/canvas";

export type NativeCanvas = typeof import("@napi-rs/canvas");
export type { SKRSContext2D };

/** Load the native Skia module outside the Next.js bundler graph. */
export function loadCanvas(): NativeCanvas {
  const require = createRequire(__filename);
  return require("@napi-rs/canvas") as NativeCanvas;
}
