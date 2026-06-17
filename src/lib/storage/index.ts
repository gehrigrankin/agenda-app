import { LocalStorageAdapter } from "./local";
import type { StorageAdapter } from "./types";

export type { StorageAdapter, StoredObject, PutObjectInput } from "./types";

/**
 * Selects the active storage adapter from STORAGE_DRIVER. Add an S3 case here
 * when the S3 adapter lands — nothing else in the app needs to change.
 */
function createStorage(): StorageAdapter {
  const driver = process.env.STORAGE_DRIVER ?? "local";
  switch (driver) {
    case "local":
      return new LocalStorageAdapter();
    // case "s3":
    //   return new S3StorageAdapter();
    default:
      throw new Error(`Unknown STORAGE_DRIVER: ${driver}`);
  }
}

export const storage: StorageAdapter = createStorage();
