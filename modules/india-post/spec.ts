/** Limits from India Post External Integrations Approach Document, updated 30.07.2026. */

export const INDIA_POST_BULK_REFERENCE_MAX = 50;
export const INDIA_POST_TRACKING_BULK_LIMIT = 500;
export const INDIA_POST_JSON_BOOKING_MAX = 999;
export const INDIA_POST_FILE_BOOKING_MAX = 5000;
export const INDIA_POST_ADDRESS_LINE_MAX = 80;
export const INDIA_POST_ADDRESS_COMBINED_MAX = 240;
export const INDIA_POST_DIMENSION_ABSOLUTE_MAX_CM = 150;
export const INDIA_POST_SPEED_POST_DOC_WEIGHT_MAX_G = 500;

export function indiaPostRequiresOtp(serviceCode: string) {
  return serviceCode.trim().toUpperCase() === "24_SPP_PARSPL";
}
