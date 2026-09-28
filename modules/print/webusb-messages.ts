export const WEBUSB_UNAVAILABLE =
  "Direct USB printing is not available in this browser. Please use a supported browser or the PostBus Print Agent.";
export const WEBUSB_UNSUPPORTED = "Unsupported printer. Reconnect a compatible USB label printer.";
export const WEBUSB_PROTOCOL_LATER =
  "This printer is not supported for direct USB printing yet. Use the PostBus Print Agent.";
export const WEBUSB_PERMISSION = "Printer permission was denied. Connect the printer and try again.";
export const WEBUSB_NOT_SELECTED = "No USB printer was selected.";
export const WEBUSB_DISCONNECTED = "The printer is disconnected. Reconnect it and try again.";
export const WEBUSB_TEST_FAILED = "Test print failed. Reconnect the printer and try again.";
export const WEBUSB_TEST_OK = "Test print sent successfully";
export const WEBUSB_PRINT_FAILED = "The printer could not print this label. Reconnect it and try again.";
export const WEBUSB_INTERFACE = "The printer interface is not available. Reconnect the printer and try again.";
export const WEBUSB_TOO_WIDE = "This label is wider than the printer can print. It was not resized.";

const SAFE_MESSAGES = new Set([
  WEBUSB_UNAVAILABLE,
  WEBUSB_UNSUPPORTED,
  WEBUSB_PROTOCOL_LATER,
  WEBUSB_PERMISSION,
  WEBUSB_NOT_SELECTED,
  WEBUSB_DISCONNECTED,
  WEBUSB_TEST_FAILED,
  WEBUSB_PRINT_FAILED,
  WEBUSB_INTERFACE,
  WEBUSB_TOO_WIDE,
  "The label page size is invalid.",
  "The label could not be prepared without resizing.",
]);

export function customerPrintError(error: unknown, fallback = WEBUSB_PRINT_FAILED) {
  if (error instanceof DOMException || (error instanceof Error && error.name)) {
    const name = error instanceof Error ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") return WEBUSB_PERMISSION;
    if (name === "NotFoundError") return WEBUSB_NOT_SELECTED;
    if (name === "NetworkError" || name === "InvalidStateError") return WEBUSB_DISCONNECTED;
  }
  if (error instanceof Error && SAFE_MESSAGES.has(error.message)) return error.message;
  return fallback;
}
