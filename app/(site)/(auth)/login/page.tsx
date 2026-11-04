import { isWhatsappOtpEnabled } from "@/lib/auth/otp/flags";
import { safeAuthNext } from "@/lib/auth/safe-next";
import { LoginForm } from "./login-form";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// Reading the query on the server renders the form in the first HTML response, instead of a
// "Loading…" placeholder that useSearchParams forced until the client bundle ran.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  return (
    <LoginForm
      otpEnabled={isWhatsappOtpEnabled()}
      next={safeAuthNext(first(query.next))}
      errorCode={first(query.error) ?? null}
    />
  );
}
