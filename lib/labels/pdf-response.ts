function safeFilename(name: string) {
  return name.replace(/[^\w.-]+/g, "_");
}

export function wantsBrowserPdfPreview(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const url = new URL(request.url);
  return !url.searchParams.has("raw") && accept.includes("text/html");
}

export function labelPdfFileResponse(bytes: Buffer | Uint8Array, filename: string) {
  const body = Buffer.from(bytes);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeFilename(filename)}"`,
      "Content-Length": String(body.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

export function labelPdfViewerResponse(filename: string) {
  const title = safeFilename(filename);
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      html, body { margin: 0; height: 100%; background: #fff; }
      embed { display: block; width: 100%; height: 100%; border: 0; }
      p { font: 14px/1.4 sans-serif; padding: 24px; color: #444; }
    </style>
  </head>
  <body>
    <embed id="viewer" type="application/pdf" />
    <script>
      fetch(location.pathname + "?raw=1", { credentials: "same-origin" })
        .then(function (res) {
          if (!res.ok) throw new Error("Could not open the label PDF.");
          return res.blob();
        })
        .then(function (blob) {
          document.getElementById("viewer").src = URL.createObjectURL(blob);
        })
        .catch(function () {
          var p = document.createElement("p");
          p.textContent = "Could not open the label PDF.";
          document.body.replaceChildren(p);
        });
    </script>
  </body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
