import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PutObjectInput, StorageAdapter, StoredObject } from "./types";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const PUBLIC_PREFIX = "/uploads";

function sanitize(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Local-disk stub: writes into /public/uploads so files are served statically
 * by Next in dev. NOT for production (the dir is ephemeral here) — it exists so
 * the upload flow can be built and tested before S3 is wired in.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly name = "local";

  async put({ ownerId, fileName, body }: PutObjectInput): Promise<StoredObject> {
    const key = `${ownerId}/${randomUUID()}-${sanitize(fileName)}`;
    const fullPath = path.join(UPLOAD_DIR, key);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, body);
    return { key, url: `${PUBLIC_PREFIX}/${key}` };
  }

  async getUrl(key: string): Promise<string> {
    return `${PUBLIC_PREFIX}/${key}`;
  }

  async delete(key: string): Promise<void> {
    await unlink(path.join(UPLOAD_DIR, key)).catch(() => {
      // Best-effort: ignore missing files.
    });
  }
}
