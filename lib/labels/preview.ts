export async function fetchLabelPdfBlob(labelId: string) {
  const response = await fetch(`/api/v1/labels/${labelId}/download?raw=1`, {
    credentials: "same-origin",
    headers: { Accept: "application/pdf" },
  });
  const type = response.headers.get("Content-Type") ?? "";
  if (!response.ok || !type.includes("application/pdf")) {
    let message = "Could not open the India Post label.";
    try {
      const payload = (await response.json()) as { message?: string };
      message = payload.message || message;
    } catch {
      // keep default
    }
    throw new Error(message);
  }
  return response.blob();
}

export async function openLabelPdf(labelId: string) {
  await fetchLabelPdfBlob(labelId);
  window.open(`/api/v1/labels/${labelId}/download?raw=1`, "_blank", "noopener,noreferrer");
}
