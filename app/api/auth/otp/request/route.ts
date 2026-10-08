import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/response";
import { OTP_MESSAGES } from "@/lib/auth/otp/policy";
import { otpRequestSchema, signupFromRequest } from "@/lib/auth/otp/schema";
import { requestWhatsappOtp } from "@/lib/auth/otp/server";

function clientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const values = otpRequestSchema.parse(body ?? {});
    const result = await requestWhatsappOtp({
      phone: values.phone,
      purpose: values.purpose,
      signup: signupFromRequest(values),
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent") ?? "",
    });
    return ok(result, OTP_MESSAGES.sent);
  } catch (error) {
    return fail(error);
  }
}
