import { randomUUID } from "node:crypto";

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { PutObjectInput, StorageAdapter, StoredObject } from "./types";

/**
 * S3 storage adapter: the production path for uploads (local disk is ephemeral
 * on Vercel; the db driver is personal-scale only). Objects are written under
 * `uploads/<ownerId>/<uuid>-<sanitized-name>` and the returned URL points at
 * the bucket directly, so the bucket (or the prefix) must be publicly
 * readable — or set S3_PUBLIC_BASE_URL to a CDN (CloudFront, R2 public URL)
 * that fronts it.
 *
 * Required env: S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.
 * Optional env:
 * - S3_PUBLIC_BASE_URL — base URL for returned object URLs (no trailing key).
 * - S3_ENDPOINT — custom endpoint for S3-compatible stores (R2, MinIO);
 *   enables path-style addressing.
 *
 * Config is resolved lazily so a missing env never throws at import time
 * (project rule: the app must still load) — only when put() is actually used.
 */

const KEY_PREFIX = "uploads";

interface S3Config {
  bucket: string;
  region: string;
  publicBaseUrl?: string;
  endpoint?: string;
  client: S3Client;
}

function sanitize(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class S3StorageAdapter implements StorageAdapter {
  readonly name = "s3";

  private config: S3Config | null = null;

  /** Build (and cache) the client from env, failing loudly if incomplete. */
  private getConfig(): S3Config {
    if (this.config) return this.config;

    const bucket = process.env.S3_BUCKET;
    const region = process.env.S3_REGION;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    const missing = Object.entries({
      S3_BUCKET: bucket,
      S3_REGION: region,
      S3_ACCESS_KEY_ID: accessKeyId,
      S3_SECRET_ACCESS_KEY: secretAccessKey,
    })
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(
        `S3 storage driver is not configured — missing env: ${missing.join(", ")}. ` +
          "Set them (see .env.example) or switch STORAGE_DRIVER.",
      );
    }

    const endpoint = process.env.S3_ENDPOINT || undefined;
    // Strip trailing slashes so URL assembly below is uniform.
    const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL?.replace(/\/+$/, "");

    this.config = {
      bucket: bucket!,
      region: region!,
      publicBaseUrl: publicBaseUrl || undefined,
      endpoint,
      client: new S3Client({
        region: region!,
        credentials: {
          accessKeyId: accessKeyId!,
          secretAccessKey: secretAccessKey!,
        },
        ...(endpoint
          ? {
              endpoint,
              // Virtual-hosted addressing rarely works on S3-compatible
              // stores; path style is the safe default there.
              forcePathStyle: true,
            }
          : {}),
      }),
    };
    return this.config;
  }

  private publicUrl(key: string): string {
    const { bucket, region, publicBaseUrl, endpoint } = this.getConfig();
    if (publicBaseUrl) return `${publicBaseUrl}/${key}`;
    if (endpoint) {
      // Path-style URL matching the custom endpoint.
      return `${endpoint.replace(/\/+$/, "")}/${bucket}/${key}`;
    }
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  async put({
    ownerId,
    fileName,
    contentType,
    body,
  }: PutObjectInput): Promise<StoredObject> {
    const { bucket, client } = this.getConfig();
    // Mirrors local.ts: uuid prefix + sanitized name defeats path traversal
    // and collisions; keys are namespaced per owner.
    const key = `${KEY_PREFIX}/${ownerId}/${randomUUID()}-${sanitize(fileName)}`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType ?? "application/octet-stream",
      }),
    );
    return { key, url: this.publicUrl(key) };
  }

  async getUrl(key: string): Promise<string> {
    return this.publicUrl(key);
  }

  async delete(key: string): Promise<void> {
    const { bucket, client } = this.getConfig();
    // S3 DeleteObject is idempotent (no error on missing keys); any other
    // failure is swallowed to stay best-effort like the local adapter.
    await client
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
      .catch((err) => {
        console.warn("[storage:s3] delete failed:", err);
      });
  }
}
