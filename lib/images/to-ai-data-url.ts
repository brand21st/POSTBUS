"use client";

import { optimizeImageFile } from "@/lib/images/optimize-client";

const MAX = 3;

async function fileToDataUrl(file: File) {
  const optimized = await optimizeImageFile(file, { maxWidth: 768, maxHeight: 768, quality: 0.72 });
  const buffer = await optimized.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const mime = optimized.type === "image/png" ? "image/png" : optimized.type === "image/webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function productPhotosToAiDataUrls(
  files: Array<File | null>,
  urls: Array<string | null>
): Promise<string[]> {
  const out: string[] = [];
  const slots = Math.max(files.length, urls.length, MAX);
  for (let slot = 0; slot < slots && out.length < MAX; slot++) {
    const file = files[slot];
    const url = urls[slot];
    try {
      if (file) {
        out.push(await fileToDataUrl(file));
        continue;
      }
      if (!url || url.startsWith("blob:")) continue;
      const response = await fetch(url);
      if (!response.ok) continue;
      const blob = await response.blob();
      const type = blob.type.startsWith("image/") ? blob.type : "image/jpeg";
      out.push(await fileToDataUrl(new File([blob], `photo-${slot}.jpg`, { type })));
    } catch {
      continue;
    }
  }
  return out;
}
