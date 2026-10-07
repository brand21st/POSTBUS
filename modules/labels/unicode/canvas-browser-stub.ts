/** Browser placeholder so Turbopack/webpack never pull native Skia into the client graph. */
export function createCanvas(): never {
  throw new Error("Unicode label painting runs on the server");
}

export const GlobalFonts = {
  registerFromPath() {
    return false;
  },
};
