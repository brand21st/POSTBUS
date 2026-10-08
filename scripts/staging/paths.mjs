import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, "../..");
export const STAGING_DIR = path.join(REPO_ROOT, ".staging");
export const PGDATA = path.join(STAGING_DIR, "pgdata");
export const PGLOG = path.join(STAGING_DIR, "postgres.log");
export const PGBIN = "C:\\Program Files\\PostgreSQL\\16\\bin";
export const PGPORT = "55432";
export const PGHOST = "127.0.0.1";
export const PGUSER = "postbus_staging";
export const PGDATABASE = "postbus_staging";
export const STUB_PORT = "4099";
export const DATABASE_URL = `postgresql://${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
export const CEPT_STUB_URL = `http://${PGHOST}:${STUB_PORT}`;
