import { createRequire } from "node:module";
import path from "node:path";
import type { SKRSContext2D } from "@napi-rs/canvas";

export type NativeCanvas = typeof import("@napi-rs/canvas");
export type { SKRSContext2D };

/** Turbopack sets __filename to a virtual /ROOT/ path, so resolve from the app cwd. */
export function canvasRequireFrom() {
  return path.join(process.cwd(), "package.json");
}

/** Load the native Skia module outside the Next.js bundler graph. */
export function loadCanvas(): NativeCanvas {
  const require = createRequire(canvasRequireFrom());
  return require("@napi-rs/canvas") as NativeCanvas;
}
