import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { safeEqual } from "@/lib/security/crypto";

const DEFAULT_PIN = "884877";

function configuredPin() {
  const value = process.env.ADMIN_ACCOUNT_ACTION_PIN?.trim() || DEFAULT_PIN;
  return value;
}

export function assertAdminActionPin(pin: unknown) {
  const value = typeof pin === "string" ? pin.trim() : "";
  const expected = configuredPin();
  if (!/^\d{6}$/.test(value) || value.length !== expected.length || !safeEqual(value, expected)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "Invalid confirmation PIN.");
  }
}
