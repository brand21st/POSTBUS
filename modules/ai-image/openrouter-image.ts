import sharp from "sharp";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { OPENROUTER_API_BASE, openRouterReferer } from "@/modules/openrouter/platform-config";
import { aspectSize, type AiImageAspect } from "@/modules/ai-image/presets";

export type ImageEditInput = {
  apiKey: string;
  model: string;
  prompt: string;
  imageDataUrl: string;
  aspect: AiImageAspect;
};

function dataUrlToBuffer(dataUrl: string) {
  const match = /^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/.exec(dataUrl.trim());
  if (!match) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Source photo is not a valid data URL.");
  return Buffer.from(match[1], "base64");
}

function extractImagePayload(json: Record<string, unknown>): string | null {
  const choices = json.choices as Array<{ message?: { images?: Array<{ image_url?: { url?: string } }>; content?: unknown } }> | undefined;
  const message = choices?.[0]?.message;
  const fromImages = message?.images?.[0]?.image_url?.url;
  if (typeof fromImages === "string" && fromImages.startsWith("data:image")) return fromImages;
  if (typeof fromImages === "string" && fromImages.startsWith("http")) return fromImages;
  const content = message?.content;
  if (typeof content === "string" && content.startsWith("data:image")) return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      const url = (part as { image_url?: { url?: string }; url?: string })?.image_url?.url
        ?? (part as { url?: string }).url;
      if (typeof url === "string") return url;
    }
  }
  const data = json.data as Array<{ b64_json?: string; url?: string }> | undefined;
  if (data?.[0]?.b64_json) return `data:image/png;base64,${data[0].b64_json}`;
  if (typeof data?.[0]?.url === "string") return data[0].url;
  return null;
}

async function toPngBuffer(raw: string) {
  if (raw.startsWith("data:image")) return dataUrlToBuffer(raw);
  if (!/^https:\/\//i.test(raw)) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Image provider returned an unsupported payload.");
  }
  const response = await fetch(raw, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Could not download generated image (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

export async function containToAspect(buffer: Buffer, aspect: AiImageAspect) {
  const { width, height } = aspectSize(aspect);
  return sharp(buffer)
    .rotate()
    .resize(width, height, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();
}

export async function editProductImage(input: ImageEditInput): Promise<Buffer> {
  const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": openRouterReferer(),
      "X-Title": "PostBus Image Studio",
    },
    body: JSON.stringify({
      model: input.model,
      modalities: ["image", "text"],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: input.prompt },
            { type: "image_url", image_url: { url: input.imageDataUrl } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(90000),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const err = json.error as { message?: string } | string | undefined;
    const message = (typeof err === "object" ? err?.message : err) || `OpenRouter image request failed (${response.status}).`;
    throw new Error(String(message));
  }
  const payload = extractImagePayload(json);
  if (!payload) {
    throw new Error("OpenRouter did not return an edited image. Check the image model in Admin settings.");
  }
  const buffer = await toPngBuffer(payload);
  return containToAspect(buffer, input.aspect);
}

export function bufferToDataUrl(buffer: Buffer, mime = "image/png") {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

export { dataUrlToBuffer };
