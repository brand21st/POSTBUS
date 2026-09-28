/** Turn off with NEXT_PUBLIC_MULTI_UP_PRINT_ENABLED=false. Unset stays on. */
export function multiUpPrintEnabled() {
  return process.env.NEXT_PUBLIC_MULTI_UP_PRINT_ENABLED !== "false";
}
