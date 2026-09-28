export async function deviceKeyForUsb(input: {
  vendorId: number;
  productId: number;
  serialNumber?: string | null;
}) {
  const serial = input.serialNumber?.trim() || "noserial";
  const material = `${input.vendorId}:${input.productId}:${serial}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
