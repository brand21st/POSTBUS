function optional(value: string | undefined) {
  return value?.trim() || "";
}

export function otpPepper() {
  return optional(process.env.OTP_PEPPER);
}

export function vachatOtpTemplateName() {
  return optional(process.env.VACHAT_OTP_TEMPLATE_NAME);
}

export function vachatOtpTemplateLanguage() {
  return optional(process.env.VACHAT_OTP_TEMPLATE_LANGUAGE) || "en";
}
