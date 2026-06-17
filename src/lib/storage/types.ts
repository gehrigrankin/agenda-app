/**
 * Storage abstraction. The MVP ships a local-disk stub; an S3 adapter can drop
 * in later by implementing this same interface and wiring it in index.ts.
 */
export interface PutObjectInput {
  /** Stable owner scope (Clerk user id) used to namespace keys. */
  ownerId: string;
  /** Original file name, used for extension + display. */
  fileName: string;
  contentType?: string;
  body: Buffer | Uint8Array;
}

export interface StoredObject {
  /** Opaque key the adapter can later resolve/delete. */
  key: string;
  /** Publicly accessible URL for the object. */
  url: string;
}

export interface StorageAdapter {
  readonly name: string;
  put(input: PutObjectInput): Promise<StoredObject>;
  /** Resolve a (possibly time-limited) URL for an existing key. */
  getUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}
