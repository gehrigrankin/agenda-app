import { eq } from "drizzle-orm";

import { db } from "@/db";
import { uploadBlobs } from "@/db/schema";
import type { PutObjectInput, StorageAdapter, StoredObject } from "./types";

/**
 * Database-backed storage: upload bytes live base64-encoded in the
 * `upload_blobs` table and are served by GET /api/uploads/[id]. Chosen as the
 * serverless default because the local-disk driver's files vanish on every
 * deploy (read-only fs on Vercel). Personal-scale only — an S3 adapter can
 * replace this via STORAGE_DRIVER without touching consumers.
 */
export class DbStorageAdapter implements StorageAdapter {
  readonly name = "db";

  async put({
    ownerId,
    contentType,
    body,
  }: PutObjectInput): Promise<StoredObject> {
    const [row] = await db
      .insert(uploadBlobs)
      .values({
        ownerId,
        mimeType: contentType ?? "application/octet-stream",
        dataBase64: Buffer.from(body).toString("base64"),
      })
      .returning({ id: uploadBlobs.id });
    return { key: row.id, url: `/api/uploads/${row.id}` };
  }

  async getUrl(key: string): Promise<string> {
    return `/api/uploads/${key}`;
  }

  async delete(key: string): Promise<void> {
    await db.delete(uploadBlobs).where(eq(uploadBlobs.id, key));
  }
}
