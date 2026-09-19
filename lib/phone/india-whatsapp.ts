export const INDIA_MOBILE_DIGITS = /^[6-9][0-9]{9}$/;
export const INDIA_WHATSAPP_E164 = /^\+91[6-9][0-9]{9}$/;

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function extractIndiaMobileDigits(value: string): string | null {
  const digits = digitsOnly(value);
  let national = digits;

  if (digits.length === 12 && digits.startsWith("91")) {
    national = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    national = digits.slice(1);
  }

  if (!INDIA_MOBILE_DIGITS.test(national)) {
    return null;
  }

  return national;
}

export function toIndiaWhatsappE164(value: string): string {
  const national = extractIndiaMobileDigits(value);
  if (!national) {
    throw new Error("Enter a 10-digit Indian WhatsApp number.");
  }
  return `+91${national}`;
}

export function isIndiaWhatsappInput(value: string): boolean {
  return extractIndiaMobileDigits(value) !== null;
}

export function indiaMobileInputDigits(value: string): string {
  return extractIndiaMobileDigits(value) ?? digitsOnly(value).slice(0, 10);
}
