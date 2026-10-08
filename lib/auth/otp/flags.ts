function optional(value: string | undefined) {
  return value?.trim() || "";
}

/** Runtime flag. Default off. Not a NEXT_PUBLIC variable. */
export function isWhatsappOtpEnabled() {
  return optional(process.env.AUTH_WHATSAPP_OTP_ENABLED).toLowerCase() === "true";
}
