/** Default on. Set POSTBUS_UNICODE_LABEL_RENDERING=false to roll back to Helvetica-only paint. */
export function unicodeLabelRenderingEnabled() {
  return process.env.POSTBUS_UNICODE_LABEL_RENDERING !== "false";
}
