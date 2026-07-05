"use client";

import { useEffect, useMemo, useRef } from "react";

export type DebouncedCallback<Args extends unknown[]> = ((
  ...args: Args
) => void) & {
  /** Immediately invoke a pending call (no-op when nothing is pending). */
  flush: () => void;
  /** Drop a pending call without invoking it. */
  cancel: () => void;
};

/**
 * Returns a debounced version of `callback` that fires `delay`ms after the last
 * call. Used for autosave so we persist on a pause in typing, not every
 * keystroke. The latest callback is always invoked (no stale closures), and any
 * pending call is flushed on unmount so trailing edits aren't lost.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number,
): DebouncedCallback<Args> {
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastArgsRef = useRef<Args | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const debounced = useMemo(() => {
    const clear = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const fn = (...args: Args) => {
      clear();
      lastArgsRef.current = args;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        lastArgsRef.current = null;
        callbackRef.current(...args);
      }, delay);
    };

    fn.flush = () => {
      if (timerRef.current === null || lastArgsRef.current === null) return;
      const args = lastArgsRef.current;
      clear();
      lastArgsRef.current = null;
      callbackRef.current(...args);
    };

    fn.cancel = () => {
      clear();
      lastArgsRef.current = null;
    };

    return fn as DebouncedCallback<Args>;
  }, [delay]);

  useEffect(() => {
    return () => {
      debounced.flush();
    };
  }, [debounced]);

  return debounced;
}
