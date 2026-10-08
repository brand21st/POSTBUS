import { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { apiRoute } from "@/lib/api/handler";
import { lookupIndiaPostPincodeDirectory } from "@/lib/india-post/pincode-directory";
import { rateLimit } from "@/lib/security/rate-limit";

export const GET = apiRoute(async (request: NextRequest) => {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  const limited = rateLimit(`${ip}:auth/pincode`, 30, 60_000);
  if (!limited.ok) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");
  }

  const pincode = request.nextUrl.searchParams.get("pincode") ?? "";
  const digits = pincode.replace(/\D/g, "").slice(0, 6);
  if (!/^[1-9][0-9]{5}$/.test(digits)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter a valid 6-digit PIN code.");
  }

  return lookupIndiaPostPincodeDirectory(digits);
});
