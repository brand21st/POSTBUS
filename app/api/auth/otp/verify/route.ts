import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/response";
import { otpVerifySchema, signupFromProfile } from "@/lib/auth/otp/schema";
import { verifyWhatsappOtp } from "@/lib/auth/otp/server";

function clientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const values = otpVerifySchema.parse(body ?? {});
    const result = await verifyWhatsappOtp({
      challengeId: values.challenge_id,
      phone: values.phone,
      purpose: values.purpose,
      otp: values.otp,
      profile: signupFromProfile(values.profile),
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent") ?? "",
    });
    return ok(result, result.status === "authenticated" ? "Signed in." : "Add your business details.");
  } catch (error) {
    return fail(error);
  }
}
