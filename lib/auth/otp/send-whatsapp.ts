import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { OTP_MESSAGES } from "@/lib/auth/otp/policy";
import { vachatOtpTemplateLanguage, vachatOtpTemplateName } from "@/lib/auth/otp/secrets";
import { sendVachatAuthenticationTemplate } from "@/modules/vachat/send";

export async function sendWhatsappOtp(phone: string, otp: string) {
  const templateName = vachatOtpTemplateName();
  if (!templateName) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, OTP_MESSAGES.sendFailed);
  }
  await sendVachatAuthenticationTemplate({
    to: phone,
    templateName,
    language: vachatOtpTemplateLanguage(),
    otp,
  });
}
