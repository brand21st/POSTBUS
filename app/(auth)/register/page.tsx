import { isWhatsappOtpEnabled } from "@/lib/auth/otp/flags";
import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  return <RegisterForm otpEnabled={isWhatsappOtpEnabled()} />;
}
