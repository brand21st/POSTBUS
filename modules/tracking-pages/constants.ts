export const RESERVED_SUBDOMAINS = [
  "www",
  "app",
  "api",
  "mail",
  "admin",
  "dashboard",
  "auth",
  "cdn",
  "static",
  "postbus",
  "status",
] as const;

export const SUBDOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$/;

export const TRACKING_PAGE_STATUSES = ["DRAFT", "PUBLISHED", "DISABLED"] as const;

export const DEFAULT_PRIMARY_COLOR = "#E11D48";
export const DEFAULT_BACKGROUND_COLOR = "#FFFFFF";

export const MAX_BANNERS = 3;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;

export const PRODUCTION_APEX_HOST = "postbus.in";
export const TEMP_APEX_HOST = "postbus.vachat.in";
export const TRACKING_PARENT_HOSTS = [PRODUCTION_APEX_HOST, TEMP_APEX_HOST] as const;

export const APEX_HOSTS = new Set([
  PRODUCTION_APEX_HOST,
  `www.${PRODUCTION_APEX_HOST}`,
  TEMP_APEX_HOST,
  `www.${TEMP_APEX_HOST}`,
  "localhost",
  "127.0.0.1",
]);
