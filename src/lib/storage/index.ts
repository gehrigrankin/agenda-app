import { DbStorageAdapter } from "./db";
import { LocalStorageAdapter } from "./local";
import { S3StorageAdapter } from "./s3";
import type { StorageAdapter } from "./types";

export type { StorageAdapter, StoredObject, PutObjectInput } from "./types";

/**
 * Selects the active storage adapter from STORAGE_DRIVER. When unset, the db
 * driver wins whenever a database is configured — the local-disk driver's
 * files are ephemeral on serverless hosts (read-only fs on Vercel), which
 * silently broke uploads in production. Set STORAGE_DRIVER=s3 (plus the S3_*
 * env vars) for the production S3 adapter — nothing else in the app needs to
 * change.
 */
function createStorage(): StorageAdapter {
  let driver =
    process.env.STORAGE_DRIVER ?? (process.env.DATABASE_URL ? "db" : "local");
  // The local driver writes to the repo's public/ dir, which is read-only on
  // Vercel — a leftover STORAGE_DRIVER=local env var there just breaks every
  // upload. Override it whenever a database is available. This only ever
  // rewrites "local": an explicitly configured s3 (or db) driver is respected.
  if (driver === "local" && process.env.VERCEL && process.env.DATABASE_URL) {
    console.warn(
      "[storage] STORAGE_DRIVER=local is not usable on Vercel — using the db driver instead.",
    );
    driver = "db";
  }
  switch (driver) {
    case "db":
      return new DbStorageAdapter();
    case "local":
      return new LocalStorageAdapter();
    case "s3":
      return new S3StorageAdapter();
    default:
      throw new Error(`Unknown STORAGE_DRIVER: ${driver}`);
  }
}

export const storage: StorageAdapter = createStorage();
