// No imports on purpose: the login form (a client component) uses this too.
export const DEFAULT_AFTER_AUTH = "/dashboard";

/**
 * Keep post-auth redirects on this site. Browsers treat "\" like "/", so "/\evil.com" is as
 * off-site as "//evil.com"; control characters can smuggle either past a prefix check.
 */
export function safeAuthNext(value?: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return DEFAULT_AFTER_AUTH;
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_AFTER_AUTH;
  return value;
}
