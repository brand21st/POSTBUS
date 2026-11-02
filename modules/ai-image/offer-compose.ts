import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { OfferOverlayInput } from "@/modules/ai-image/offer";
import { offerCopyFromInput } from "@/modules/ai-image/offer";

export async function composeOfferPoster(background: Buffer, input: OfferOverlayInput): Promise<Buffer> {
  const image = await loadImage(background);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, image.width, image.height);

  const copy = offerCopyFromInput(input);
  const pad = Math.round(image.width * 0.06);
  const barHeight = Math.round(image.height * 0.34);
  const top = image.height - barHeight;

  ctx.fillStyle = "rgba(9, 9, 11, 0.72)";
  ctx.fillRect(0, top, image.width, barHeight);

  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${Math.round(image.width * 0.045)}px sans-serif`;
  ctx.fillText(copy.headline, pad, top + Math.round(barHeight * 0.28));

  ctx.font = `700 ${Math.round(image.width * 0.055)}px sans-serif`;
  const name = copy.name.length > 28 ? `${copy.name.slice(0, 27)}…` : copy.name;
  ctx.fillText(name, pad, top + Math.round(barHeight * 0.5));

  ctx.font = `700 ${Math.round(image.width * 0.06)}px sans-serif`;
  ctx.fillText(copy.price, pad, top + Math.round(barHeight * 0.74));
  let x = pad + ctx.measureText(copy.price).width + 16;
  if (copy.compareAt) {
    ctx.font = `500 ${Math.round(image.width * 0.035)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(copy.compareAt, x, top + Math.round(barHeight * 0.74));
    const strike = ctx.measureText(copy.compareAt).width;
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.moveTo(x, top + Math.round(barHeight * 0.7));
    ctx.lineTo(x + strike, top + Math.round(barHeight * 0.7));
    ctx.stroke();
    x += strike + 14;
  }
  if (copy.discountPercent > 0) {
    ctx.fillStyle = "#fb7185";
    ctx.font = `700 ${Math.round(image.width * 0.032)}px sans-serif`;
    ctx.fillText(`${copy.discountPercent}% OFF`, x, top + Math.round(barHeight * 0.74));
  }

  const ctaW = Math.round(image.width * 0.28);
  const ctaH = Math.round(barHeight * 0.28);
  const ctaX = image.width - pad - ctaW;
  const ctaY = top + Math.round(barHeight * 0.58);
  ctx.fillStyle = "#e11d48";
  roundRect(ctx, ctaX, ctaY, ctaW, ctaH, 12);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${Math.round(image.width * 0.032)}px sans-serif`;
  const ctaWidth = ctx.measureText(copy.cta).width;
  ctx.fillText(copy.cta, ctaX + (ctaW - ctaWidth) / 2, ctaY + ctaH * 0.68);

  if (copy.expiry) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = `500 ${Math.round(image.width * 0.022)}px sans-serif`;
    ctx.fillText(copy.expiry, pad, image.height - pad * 0.35);
  }

  return canvas.toBuffer("image/png");
}

function roundRect(
  ctx: { beginPath: () => void; moveTo: (x: number, y: number) => void; arcTo: (x1: number, y1: number, x2: number, y2: number, r: number) => void; closePath: () => void },
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
