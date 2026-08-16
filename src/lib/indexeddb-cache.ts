"use client";

/**
 * Tiny owner-scoped IndexedDB cache used by the three high-traffic app views.
 * Values stay fully typed at each call site; IndexedDB is only the persistence
 * mechanism, while server actions remain the source of truth on every mount.
 */

const DB_NAME = "agenda-view-cache";
const STORE_NAME = "entries";
const DB_VERSION = 1;
const KEY_VERSION = 1;

export type ViewCacheArea =
  | "tasks"
  | "daily-note-window"
  | "calendar-local"
  | "calendar-ics";

export type CacheEntry<T> = {
  value: T;
  updatedAt: number;
};

export interface CacheAdapter {
  read<T>(key: string): Promise<CacheEntry<T> | null>;
  write<T>(key: string, entry: CacheEntry<T>): Promise<void>;
  delete(key: string): Promise<void>;
}

export function viewCacheKey(
  ownerScope: string,
  area: ViewCacheArea,
  identity = "default",
): string {
  return `v${KEY_VERSION}:${ownerScope}:${area}:${identity}`;
}

function openCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const indexedDbViewCache: CacheAdapter = {
  async read<T>(key: string): Promise<CacheEntry<T> | null> {
    const database = await openCacheDb();
    if (!database) return null;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () =>
        resolve((request.result as CacheEntry<T> | undefined) ?? null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => database.close();
    });
  },

  async write<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    const database = await openCacheDb();
    if (!database) return;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(entry, key);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    });
  },

  async delete(key: string): Promise<void> {
    const database = await openCacheDb();
    if (!database) return;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    });
  },
};

export type CacheValueSource = "cache" | "fresh";

/**
 * Paint a cached value when available, then always revalidate from the server.
 * Cache failures are deliberately non-fatal: a browser privacy setting should
 * only disable the warm-load optimization, never disable the app itself.
 */
export async function loadCachedThenRefresh<T>({
  key,
  refresh,
  onValue,
  onError,
  cancelled = () => false,
  cache = indexedDbViewCache,
  now = Date.now,
}: {
  key: string;
  refresh: () => Promise<T>;
  onValue: (value: T, source: CacheValueSource) => void;
  onError?: (error: unknown) => void;
  cancelled?: () => boolean;
  cache?: CacheAdapter;
  now?: () => number;
}): Promise<void> {
  try {
    const cached = await cache.read<T>(key);
    if (cached && !cancelled()) onValue(cached.value, "cache");
  } catch {
    // IndexedDB unavailable/corrupt: continue with the authoritative request.
  }

  try {
    const fresh = await refresh();
    try {
      await cache.write(key, { value: fresh, updatedAt: now() });
    } catch {
      // The fresh value is still valid even when persistence fails.
    }
    if (!cancelled()) onValue(fresh, "fresh");
  } catch (error) {
    if (!cancelled()) onError?.(error);
  }
}
