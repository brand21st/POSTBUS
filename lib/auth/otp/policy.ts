export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_SEND_WINDOW_MS = 15 * 60 * 1000;
export const OTP_PHONE_SEND_LIMIT = 5;
export const OTP_IP_SEND_LIMIT = 10;
export const OTP_PROFILE_WINDOW_MS = 10 * 60 * 1000;

export const OTP_MESSAGES = {
  sent: "Code sent.",
  wait: "Please wait before requesting another code.",
  invalid: "Invalid or expired OTP.",
  locked: "Too many attempts. Request a new code.",
  sendFailed: "Could not send a code. Try again.",
  duplicatePhone: "Unable to sign in. Contact support.",
  duplicateEmail: "Unable to create your account. Contact support.",
  unavailable: "WhatsApp sign-in is not available.",
  signInFailed: "Could not sign you in. Request a new code.",
  phone: "Enter a 10-digit Indian WhatsApp number.",
} as const;

export function sendWindowStart(nowMs: number, windowMs = OTP_SEND_WINDOW_MS) {
  return new Date(Math.floor(nowMs / windowMs) * windowMs);
}

export function bucketAllows(count: number, limit: number) {
  return count <= limit;
}
