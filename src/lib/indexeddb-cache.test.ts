import { describe, expect, it, vi } from "vitest";

import {
  loadCachedThenRefresh,
  viewCacheKey,
  type CacheAdapter,
  type CacheEntry,
} from "./indexeddb-cache";

function memoryCache(initial?: CacheEntry<unknown>): CacheAdapter {
  let entry = initial ?? null;
  return {
    async read<T>() {
      return entry as CacheEntry<T> | null;
    },
    async write<T>(_key: string, next: CacheEntry<T>) {
      entry = next as CacheEntry<unknown>;
    },
    async delete() {
      entry = null;
    },
  };
}

describe("viewCacheKey", () => {
  it("separates owners, views, and range identities", () => {
    expect(viewCacheKey("owner-a", "calendar-local", "2026-08")).toBe(
      "v1:owner-a:calendar-local:2026-08",
    );
    expect(viewCacheKey("owner-b", "calendar-local", "2026-08")).not.toBe(
      viewCacheKey("owner-a", "calendar-local", "2026-08"),
    );
  });
});

describe("loadCachedThenRefresh", () => {
  it("emits the warm value first and the authoritative value second", async () => {
    const values: Array<[string, string]> = [];
    const cache = memoryCache({ value: "warm", updatedAt: 1 });

    await loadCachedThenRefresh({
      key: "key",
      cache,
      now: () => 42,
      refresh: async () => "fresh",
      onValue: (value, source) => values.push([value, source]),
    });

    expect(values).toEqual([
      ["warm", "cache"],
      ["fresh", "fresh"],
    ]);
    await expect(cache.read<string>("key")).resolves.toEqual({
      value: "fresh",
      updatedAt: 42,
    });
  });

  it("keeps cached data visible when revalidation fails", async () => {
    const onValue = vi.fn();
    const onError = vi.fn();

    await loadCachedThenRefresh({
      key: "key",
      cache: memoryCache({ value: "warm", updatedAt: 1 }),
      refresh: async () => {
        throw new Error("offline");
      },
      onValue,
      onError,
    });

    expect(onValue).toHaveBeenCalledOnce();
    expect(onValue).toHaveBeenCalledWith("warm", "cache");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("does not update an unmounted consumer", async () => {
    const onValue = vi.fn();

    await loadCachedThenRefresh({
      key: "key",
      cache: memoryCache({ value: "warm", updatedAt: 1 }),
      refresh: async () => "fresh",
      cancelled: () => true,
      onValue,
    });

    expect(onValue).not.toHaveBeenCalled();
  });
});
