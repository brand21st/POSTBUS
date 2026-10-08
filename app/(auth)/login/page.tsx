import { Suspense } from "react";
import { isWhatsappOtpEnabled } from "@/lib/auth/otp/flags";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <LoginForm otpEnabled={isWhatsappOtpEnabled()} />
    </Suspense>
  );
}
