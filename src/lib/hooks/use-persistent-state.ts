"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * localStorage-backed state that is safe to render on the server.
 *
 * The server (and the hydration pass) always sees `fallback`; the stored value
 * takes over in the post-hydration re-render that useSyncExternalStore forces
 * before paint, so a persisted layout (a collapsed sidebar, a dragged width)
 * doesn't flash its default first the way the old "read in a mount effect"
 * pattern did.
 *
 * Values are JSON. A malformed or missing entry, a private-mode storage that
 * throws, or a value `validate` rejects all read as `fallback`. Every hook
 * instance on the same key shares one value — writes notify same-tab
 * subscribers directly, and other tabs through the `storage` event.
 */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
// Parsed-value cache: useSyncExternalStore compares snapshots with Object.is,
// so getSnapshot must return the same object until the raw string changes.
const cache = new Map<string, { raw: string | null; value: unknown }>();

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function notify(key: string) {
  listeners.get(key)?.forEach((l) => l());
}

let storageListenerBound = false;
function bindStorageListener() {
  if (storageListenerBound || typeof window === "undefined") return;
  storageListenerBound = true;
  window.addEventListener("storage", (e) => {
    if (e.key === null) listeners.forEach((_, k) => notify(k));
    else if (listeners.has(e.key)) notify(e.key);
  });
}

export function readPersistent<T>(
  key: string,
  fallback: T,
  validate?: (v: unknown) => v is T,
): T {
  const raw = readRaw(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value: unknown = fallback;
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      value = validate && !validate(parsed) ? fallback : parsed;
    } catch {
      value = fallback;
    }
  }
  cache.set(key, { raw, value });
  return value as T;
}

export function writePersistent<T>(key: string, value: T) {
  const raw = JSON.stringify(value);
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    // Storage full / blocked: keep the value for this session only.
  }
  cache.set(key, { raw: readRaw(key) ?? raw, value });
  notify(key);
}

export function usePersistentState<T>(
  key: string,
  fallback: T,
  validate?: (v: unknown) => v is T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const subscribe = useCallback(
    (listener: Listener) => {
      bindStorageListener();
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(listener);
      return () => {
        set!.delete(listener);
        if (set!.size === 0) listeners.delete(key);
      };
    },
    [key],
  );
  // `fallback` is read through the closure on purpose: callers pass inline
  // literals, and keying the snapshot on their identity would loop.
  const value = useSyncExternalStore(
    subscribe,
    () => readPersistent(key, fallback, validate),
    () => fallback,
  );
  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = readPersistent(key, fallback, validate);
      const resolved =
        typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      writePersistent(key, resolved);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [value, setValue];
}
