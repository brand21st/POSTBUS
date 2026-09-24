"use client";

import { useEffect, useState } from "react";

type PdfRasterPreviewProps = {
  bytes: ArrayBuffer;
  title: string;
};

export function usePdfFirstPageUrl(bytes: ArrayBuffer | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bytes) {
      setUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.8 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not draw the label.");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not draw the label.");
      objectUrl = URL.createObjectURL(blob);
      if (!cancelled) setUrl(objectUrl);
    })().catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not show the PDF.");
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bytes]);

  return { url, error };
}

export function PdfRasterPreview({ bytes, title }: PdfRasterPreviewProps) {
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    setPages([]);
    setError(null);

    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
      const rendered: string[] = [];
      for (let index = 1; index <= pdf.numPages; index += 1) {
        const page = await pdf.getPage(index);
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not draw the label.");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        rendered.push(url);
      }
      if (!cancelled) setPages(rendered);
    })().catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not show the PDF.");
    });

    return () => {
      cancelled = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [bytes]);

  if (error) {
    return <p className="p-6 text-sm text-muted">{error}</p>;
  }
  if (!pages.length) {
    return <p className="p-6 text-sm text-muted">Loading {title}…</p>;
  }

  return (
    <div className="space-y-4 bg-zinc-100 p-3">
      {pages.map((src, index) => (
        <figure key={src} className="mx-auto max-w-xl">
          <img src={src} alt={`${title} page ${index + 1}`} className="w-full bg-white shadow-sm" />
          {pages.length > 1 ? (
            <figcaption className="mt-1 text-center text-xs text-muted">
              Page {index + 1} of {pages.length}
            </figcaption>
          ) : null}
        </figure>
      ))}
    </div>
  );
}
