"use client";

type OptimizeOptions = {
  maxWidth: number;
  maxHeight: number;
  quality?: number;
};

export async function optimizeImageFile(file: File, options: OptimizeOptions) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file;
  if (typeof createImageBitmap !== "function") return file;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, options.maxWidth / bitmap.width, options.maxHeight / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", options.quality ?? 0.84)
    );
    if (!blob || blob.size >= file.size) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${baseName}.webp`, { type: "image/webp", lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}
